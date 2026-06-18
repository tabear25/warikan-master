// 整数円の割り勘配分（最大剰余方式 / Hamilton 法）。
// サーバの精算計算とクライアントのプレビューの両方から使う純粋関数。

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

  // 全重みが 0 の場合は均等割りにフォールバック。
  if (weightSum <= 0) {
    return splitYen(safeTotal, order);
  }

  const exact = w.map((wi) => (safeTotal * wi) / weightSum);
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
