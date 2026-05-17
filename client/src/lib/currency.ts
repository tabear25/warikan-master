// 金額表示用の整形ユーティリティ。
// 計算は行わず、表示のみを担当する（Math.round + toLocaleString は既存挙動と同一）。

// 符号なし表示。負数は簿記風に ▲ を付ける。支払い一覧・送金リスト（正数のみ）に使う。
// 例: 3500 -> "¥3,500" / -1000 -> "▲¥1,000"
export function formatYen(amount: number): string {
  const rounded = Math.round(amount);
  const abs = Math.abs(rounded).toLocaleString("ja-JP");
  return rounded < 0 ? `▲¥${abs}` : `¥${abs}`;
}

// 符号付き表示。各自の収支に使う。
// 例: 2000 -> "+¥2,000" / -1000 -> "▲¥1,000" / 0 -> "¥0"
export function formatSignedYen(amount: number): string {
  const rounded = Math.round(amount);
  if (rounded === 0) return "¥0";
  if (rounded > 0) return `+¥${rounded.toLocaleString("ja-JP")}`;
  return `▲¥${Math.abs(rounded).toLocaleString("ja-JP")}`;
}
