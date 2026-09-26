// 精算（誰が誰にいくら送るか）の計算。
// サーバの精算 API と、クライアントの部分精算プレビューの両方から使う純粋関数。
// クライアント側で再実装しないこと（送金額が画面とサーバでずれる）。

import { computeShares, type PaymentSplitInput } from "./split";

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface SettlementResult {
  transfers: Transfer[];
  balances: Record<number, number>;
}

// Payment 行がそのまま渡せる構造型（split.ts の PaymentSplitInput と同じく、
// drizzle / zod から切り離しておくため）。
export interface SettlementPaymentInput extends PaymentSplitInput {
  payerId: number;
}

/**
 * Greedy minimal-transfer settlement. Computes each member's net balance in
 * whole yen, then repeatedly matches the largest debtor with the largest
 * creditor. Because every payment's shares sum to its integer total, the global
 * balances sum to exactly zero, so the matching is exact (no float tolerance).
 */
export function calculateSettlement(
  memberList: Array<{ id: number; name: string }>,
  paymentList: SettlementPaymentInput[],
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

// ---------------------------------------------------------------------------
// 部分精算（例: 旅行前にホテル代と飛行機代だけ先に精算する）
// ---------------------------------------------------------------------------

export interface PartialAwarePaymentInput extends SettlementPaymentInput {
  id: number;
  partialSettlementId?: number | null;
}

/** 先に精算した区切り1つぶんの内容。transfers / balances はその区切りの支払いだけで計算する。 */
export interface PartialSettlementSummary extends SettlementResult {
  id: number;
  createdAt: string;
  paymentIds: number[];
  total: number;
}

/** GET /api/events/:id/settlement の形。transfers / balances は「残り（未精算分）」。 */
export interface SettlementWithPartials extends SettlementResult {
  partialSettlements: PartialSettlementSummary[];
}

/** 区切り1つぶんの内容を、その区切りに含まれる支払いだけから組み立てる。 */
export function summarizePartialSettlement(
  memberList: Array<{ id: number; name: string }>,
  partial: { id: number; createdAt: string },
  includedPayments: PartialAwarePaymentInput[],
): PartialSettlementSummary {
  return {
    id: partial.id,
    createdAt: partial.createdAt,
    paymentIds: includedPayments.map((payment) => payment.id),
    total: includedPayments.reduce((acc, payment) => acc + Math.round(payment.amount), 0),
    ...calculateSettlement(memberList, includedPayments),
  };
}

/**
 * 支払いを「先に精算した区切り」ごとと「残り（どの区切りにも含まれない支払い）」とに
 * 分け、それぞれで精算を計算する。
 *
 * 1件ごとの負担の合計は支払額に一致するので、どの区切りでも収支の合計は 0 になる。
 * そのため区切りごとに精算しても、全員の最終的な収支は一括で精算した場合と変わらない
 * （変わりうるのは送金の回数だけ）。
 *
 * 存在しない区切りを指している支払いは残りに戻す。どこにも表示されずに精算から
 * 漏れるより、残りに出ているほうが気づける。
 */
export function calculateSettlementWithPartials(
  memberList: Array<{ id: number; name: string }>,
  paymentList: PartialAwarePaymentInput[],
  partialList: Array<{ id: number; createdAt: string }>,
): SettlementWithPartials {
  const knownPartialIds = new Set(partialList.map((partial) => partial.id));
  const remaining: PartialAwarePaymentInput[] = [];
  const paymentsByPartial = new Map<number, PartialAwarePaymentInput[]>();

  for (const payment of paymentList) {
    const partialId = payment.partialSettlementId ?? null;
    if (partialId === null || !knownPartialIds.has(partialId)) {
      remaining.push(payment);
      continue;
    }
    const included = paymentsByPartial.get(partialId);
    if (included) {
      included.push(payment);
    } else {
      paymentsByPartial.set(partialId, [payment]);
    }
  }

  const partialSettlements = partialList.map((partial) =>
    summarizePartialSettlement(memberList, partial, paymentsByPartial.get(partial.id) ?? []),
  );

  return { ...calculateSettlement(memberList, remaining), partialSettlements };
}
