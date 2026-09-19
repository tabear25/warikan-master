import type { Payment } from "@shared/schema";
import { computeShares } from "@shared/split";

// 割り当ての本体は @shared/split にある（クライアントの送金リスト詳細も同じものを使う）。
// 既存の import 先を変えずに済むよう、ここからも再エクスポートする。
export { computeShares };

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
