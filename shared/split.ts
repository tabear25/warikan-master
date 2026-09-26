// 整数円の割り勘配分（最大剰余方式 / Hamilton 法）。
// サーバの精算計算とクライアントのプレビューの両方から使う純粋関数。
//
// 注意: 精算結果（部分精算の区切りを含む）は保存せず、毎回ここから計算し直している。
// 配分の規則（端数の配り方など）を変えると、すでに送金済みかもしれない過去の区切りや
// 精算済みイベントの金額も黙って変わる。変えるときはその影響を先に確認すること
// （server/settlement.test.ts の部分精算のテストが、区切りの送金額を固定している）。

/**
 * `total`（整数円）を `order` の参加者に配分し、各人の取り分の合計が `total` に
 * 厳密に一致するようにする。各人 floor(total*w/Σw) を割り当て、余り円を小数部の
 * 大きい順（同点は order 順）に 1 円ずつ配る。weights 省略時は全員等しい重み 1。
 */
export function splitYen(
  total: number,
  order: number[],
  weights?: Record<number, number>,
): Map<number, number> {
  const result = new Map<number, number>();
  if (order.length === 0) return result;

  const safeTotal = Math.round(total);
  const w = order.map((id) => {
    const value = weights ? weights[id] : 1;
    return value && value > 0 ? value : weights ? 0 : 1;
  });
  const weightSum = w.reduce((acc, value) => acc + value, 0);

  // 全重みが 0、または合計が非有限（極端に大きな重みでオーバーフローした）場合は
  // 均等割りにフォールバックする。ここを抜けると下の while が
  // remainder = ±Infinity / NaN になって停止しなくなる。
  // 入口の検証（shared/schema.ts の weightRecord）で弾いているが、この関数は
  // クライアントのプレビューからも直接呼ばれるので自分でも守る。
  if (!(weightSum > 0) || !Number.isFinite(weightSum)) {
    return splitYen(safeTotal, order);
  }

  const exact = w.map((wi) => (safeTotal * wi) / weightSum);
  // safeTotal * wi の段階でオーバーフローすると exact が Infinity になる。
  if (!exact.every((value) => Number.isFinite(value))) {
    return splitYen(safeTotal, order);
  }

  const floors = exact.map(Math.floor);
  const floorSum = floors.reduce((acc, value) => acc + value, 0);
  let remainder = safeTotal - floorSum;

  order.forEach((id, index) => result.set(id, floors[index]));

  const ranked = order
    .map((id, index) => ({ id, index, frac: exact[index] - floors[index] }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const step = remainder >= 0 ? 1 : -1;
  let pointer = 0;
  while (remainder !== 0 && ranked.length > 0) {
    const target = ranked[pointer % ranked.length].id;
    result.set(target, (result.get(target) ?? 0) + step);
    remainder -= step;
    pointer += 1;
  }

  return result;
}

// 1件の支払いの「誰がいくら負担したか」。Payment 行がそのまま渡せる構造型に
// しているのは、この純粋関数を drizzle / zod から切り離しておくため。
export interface PaymentSplitInput {
  amount: number;
  splitMemberIds: string; // JSON array of member IDs
  splitMode?: string | null;
  splitDetails?: string | null; // JSON object keyed by member id
}

/**
 * Compute the per-member integer-yen share for a single payment, dispatching on
 * its split mode. Legacy rows (no `splitMode` / `splitDetails`) are treated as
 * an equal split, preserving historical behaviour.
 *
 * サーバの精算計算と、クライアントの送金リスト詳細の両方がこれを使う。
 */
export function computeShares(payment: PaymentSplitInput): Map<number, number> {
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
