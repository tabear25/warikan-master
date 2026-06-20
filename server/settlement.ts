import type { Payment } from "@shared/schema";
import { splitYen } from "@shared/split";

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementResult {
  transfers: Transfer[];
  balances: Record<number, number>;
}

/**
 * Compute the per-member integer-yen share for a single payment, dispatching on
 * its split mode. Legacy rows (no `splitMode` / `splitDetails`) are treated as
 * an equal split, preserving historical behaviour.
 */
export function computeShares(payment: Payment): Map<number, number> {
  const participants: number[] = JSON.parse(payment.splitMemberIds);
  const total = Math.round(payment.amount);
  const mode = payment.splitMode ?? "equal";

  if (mode === "amount" && payment.splitDetails) {
    const detail = JSON.parse(payment.splitDetails) as Record<string, number>;
    const shares = new Map<number, number>();
    participants.forEach((id) => shares.set(id, Math.round(detail[String(id)] ?? 0)));
    return shares;
  }

  if (mode === "ratio" && payment.splitDetails) {
    const detail = JSON.parse(payment.splitDetails) as Record<string, number>;
    const weights: Record<number, number> = {};
    participants.forEach((id) => {
      weights[id] = detail[String(id)] ?? 0;
    });
    return splitYen(total, participants, weights);
  }

  // equal (also covers all legacy rows)
  return splitYen(total, participants);
}

/**
 * Greedy minimal-transfer settlement. Computes each member's net balance in
 * whole yen, then repeatedly matches the largest debtor with the largest
 * creditor. Because every payment's shares sum to its integer total, the global
 * balances sum to exactly zero, so the matching is exact (no float tolerance).
 */
export function calculateSettlement(
  memberList: Array<{ id: number; name: string }>,
  paymentList: Payment[],
): SettlementResult {
  const balances: Record<number, number> = {};
  memberList.forEach((member) => {
    balances[member.id] = 0;
  });

  for (const payment of paymentList) {
    const total = Math.round(payment.amount);
    const shares = computeShares(payment);

    balances[payment.payerId] = (balances[payment.payerId] ?? 0) + total;
    shares.forEach((share, memberId) => {
      balances[memberId] = (balances[memberId] ?? 0) - share;
    });
  }

  const debtors = memberList
    .filter((member) => balances[member.id] < 0)
    .map((member) => ({ id: member.id, name: member.name, amount: -balances[member.id] }))
    .sort((left, right) => right.amount - left.amount);

  const creditors = memberList
    .filter((member) => balances[member.id] > 0)
    .map((member) => ({ id: member.id, name: member.name, amount: balances[member.id] }))
    .sort((left, right) => right.amount - left.amount);

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0) {
      transfers.push({ from: debtor.name, to: creditor.name, amount });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount === 0) debtorIndex += 1;
    if (creditor.amount === 0) creditorIndex += 1;
  }

  return { transfers, balances };
}
