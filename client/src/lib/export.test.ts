// 精算結果の書き出し（テキスト / CSV）のテスト。
// 受け取り方の表示は「送金先の名前」をキーにしたマップ引きで実装されているため、
// 名前が絡む条件を明示的に固定しておく。
import { describe, it, expect } from "vitest";
import { buildSettlementText, buildSettlementCsv, buildPartialSettlementText } from "./export";

const base = {
  eventName: "京都旅行",
  members: [
    { id: 1, name: "田中", payoutLabel: "銀行振込" },
    { id: 2, name: "鈴木", payoutLabel: null },
    { id: 3, name: "佐藤", payoutLabel: "PayPay" },
  ],
  balances: { 1: 6000, 2: -3000, 3: -3000 },
  transfers: [
    { from: "鈴木", to: "田中", amount: 3000 },
    { from: "佐藤", to: "田中", amount: 3000 },
  ],
};

describe("buildSettlementText", () => {
  it("送金先に受け取り方があれば行末に添える", () => {
    const text = buildSettlementText(base);
    expect(text).toContain("・鈴木 → 田中: ¥3,000（受け取り方: 銀行振込）");
    expect(text).toContain("・佐藤 → 田中: ¥3,000（受け取り方: 銀行振込）");
  });

  it("受け取り方が未設定の相手には何も添えない", () => {
    const text = buildSettlementText({
      ...base,
      transfers: [{ from: "田中", to: "鈴木", amount: 1000 }],
    });
    expect(text).toContain("・田中 → 鈴木: ¥1,000");
    expect(text).not.toContain("受け取り方");
  });

  it("受け取り方は送金元ではなく送金先のものを出す", () => {
    // 田中（銀行振込）が佐藤（PayPay）へ送る場合、出るのは佐藤の PayPay。
    const text = buildSettlementText({
      ...base,
      transfers: [{ from: "田中", to: "佐藤", amount: 500 }],
    });
    expect(text).toContain("（受け取り方: PayPay）");
    expect(text).not.toContain("銀行振込");
  });

  it("送金が無い場合は精算不要と書く", () => {
    const text = buildSettlementText({ ...base, transfers: [] });
    expect(text).toContain("・精算は不要です");
  });
});

describe("buildSettlementCsv", () => {
  it("収支行と送金行の両方に受け取り方の列が出る", () => {
    const csv = buildSettlementCsv(base);
    const lines = csv.replace(/^﻿/, "").split("\n");
    expect(lines[0]).toBe("セクション,項目1,項目2,金額,受け取り方");
    expect(lines).toContain("収支,田中,,6000,銀行振込");
    expect(lines).toContain("収支,鈴木,,-3000,");
    expect(lines).toContain("送金,鈴木,田中,3000,銀行振込");
  });

  it("BOM 付きで始まる（Excel の文字化け対策）", () => {
    expect(buildSettlementCsv(base).startsWith("﻿")).toBe(true);
  });

  it("カンマを含む名前をクォートする", () => {
    const csv = buildSettlementCsv({
      ...base,
      members: [{ id: 1, name: "田中, 太郎", payoutLabel: "銀行振込" }],
      balances: { 1: 0 },
      transfers: [],
    });
    expect(csv).toContain('収支,"田中, 太郎",,0,銀行振込');
  });
});

// 旅行前にホテル代と飛行機代だけ先に精算した、という状態。
const earlyPartial = {
  label: "6/26（金）10:00",
  payments: [
    { description: "ホテル代", amount: 90_000 },
    { description: "飛行機代", amount: 150_000 },
  ],
  total: 240_000,
  transfers: [
    { from: "鈴木", to: "田中", amount: 80_000 },
    { from: "佐藤", to: "田中", amount: 80_000 },
  ],
};

describe("部分精算の書き出し", () => {
  it("精算テキスト: 先に精算した分があれば、残りである旨と区切りの一覧を添える", () => {
    const text = buildSettlementText({ ...base, partials: [earlyPartial] });
    expect(text).toContain("■ 各自の収支（先に精算した分を除く）");
    expect(text).toContain("■ 送金リスト（残り）");
    expect(text).toContain("■ 先に精算した分（上の送金リストには含みません）");
    expect(text).toContain("・6/26（金）10:00に精算: ホテル代、飛行機代（計 ¥240,000）");
  });

  it("精算テキスト: 残りの送金が無ければ「残りの精算は不要」と書く", () => {
    const text = buildSettlementText({ ...base, transfers: [], partials: [earlyPartial] });
    expect(text).toContain("・残りの精算は不要です");
    expect(text).not.toContain("・精算は不要です");
  });

  it("先に精算する分のテキスト: 対象の支払い・合計・送金先の受け取り方を出す", () => {
    const text = buildPartialSettlementText(base.eventName, base.members, earlyPartial);
    expect(text.split("\n")[0]).toBe("【京都旅行】先に精算する分");
    expect(text).toContain("・ホテル代: ¥90,000");
    expect(text).toContain("・飛行機代: ¥150,000");
    expect(text).toContain("・合計: ¥240,000");
    expect(text).toContain("・鈴木 → 田中: ¥80,000（受け取り方: 銀行振込）");
  });

  it("先に精算する分のテキスト: 送金が無ければその旨を書く", () => {
    const text = buildPartialSettlementText(base.eventName, base.members, { ...earlyPartial, transfers: [] });
    expect(text).toContain("・送金は不要です");
  });

  it("CSV: 残りの行に（残り）を付け、先に精算した送金を区切りのラベル付きで足す", () => {
    const lines = buildSettlementCsv({ ...base, partials: [earlyPartial] }).replace(/^﻿/, "").split("\n");
    expect(lines).toContain("収支（残り）,田中,,6000,銀行振込");
    expect(lines).toContain("送金（残り）,鈴木,田中,3000,銀行振込");
    expect(lines).toContain("先に精算 6/26（金）10:00,鈴木,田中,80000,銀行振込");
    expect(lines).toContain("先に精算 6/26（金）10:00,佐藤,田中,80000,銀行振込");
  });

  it("CSV: 同じ日の区切りが2つあっても、時刻入りのラベルで見分けられる", () => {
    const later = { ...earlyPartial, label: "6/26（金）18:30", transfers: [{ from: "佐藤", to: "鈴木", amount: 1_000 }] };
    const lines = buildSettlementCsv({ ...base, partials: [earlyPartial, later] }).replace(/^﻿/, "").split("\n");
    expect(lines).toContain("先に精算 6/26（金）10:00,鈴木,田中,80000,銀行振込");
    expect(lines).toContain("先に精算 6/26（金）18:30,佐藤,鈴木,1000,");
  });
});
