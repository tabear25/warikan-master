import { describe, it, expect } from "vitest";
import type { Payment } from "@shared/schema";
import { computeShares, calculateSettlement } from "./settlement";

let paymentId = 0;

function makePayment(overrides: Partial<Payment> & Pick<Payment, "payerId" | "amount" | "splitMemberIds">): Payment {
  return {
    id: ++paymentId,
    eventId: 1,
    description: "テスト支払い",
    splitMode: "equal",
    splitDetails: null,
    scheduleItemId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeShares", () => {
  it("equal モード: 均等割り", () => {
    const shares = computeShares(
      makePayment({ payerId: 1, amount: 3000, splitMemberIds: "[1,2,3]" }),
    );
    expect(shares.get(1)).toBe(1000);
    expect(shares.get(2)).toBe(1000);
    expect(shares.get(3)).toBe(1000);
  });

  it("ratio モード: splitDetails のウェイトで配分", () => {
    const shares = computeShares(
      makePayment({
        payerId: 1,
        amount: 1000,
        splitMemberIds: "[1,2]",
        splitMode: "ratio",
        splitDetails: JSON.stringify({ "1": 2, "2": 1 }),
      }),
    );
    expect(shares.get(1)).toBe(667);
    expect(shares.get(2)).toBe(333);
  });

  it("amount モード: 指定額そのまま（欠落メンバーは0円）", () => {
    const shares = computeShares(
      makePayment({
        payerId: 1,
        amount: 1000,
        splitMemberIds: "[1,2,3]",
        splitMode: "amount",
        splitDetails: JSON.stringify({ "1": 700, "2": 300 }),
      }),
    );
    expect(shares.get(1)).toBe(700);
    expect(shares.get(2)).toBe(300);
    expect(shares.get(3)).toBe(0);
  });

  it("legacy 行（splitDetails なし）は均等割り", () => {
    const shares = computeShares(
      makePayment({ payerId: 1, amount: 100, splitMemberIds: "[1,2]" }),
    );
    expect(shares.get(1)).toBe(50);
    expect(shares.get(2)).toBe(50);
  });
});

describe("calculateSettlement", () => {
  const members = [
    { id: 1, name: "田中" },
    { id: 2, name: "鈴木" },
    { id: 3, name: "佐藤" },
  ];

  it("1件の支払いで2人 → 転送1件", () => {
    const result = calculateSettlement(
      [members[0], members[1]],
      [makePayment({ payerId: 1, amount: 1000, splitMemberIds: "[1,2]" })],
    );
    expect(result.transfers).toEqual([{ from: "鈴木", to: "田中", amount: 500 }]);
    expect(result.balances[1]).toBe(500);
    expect(result.balances[2]).toBe(-500);
  });

  it("支払者が splitMemberIds に含まれない場合（他人の分を立て替え）", () => {
    const result = calculateSettlement(
      members,
      [makePayment({ payerId: 1, amount: 1000, splitMemberIds: "[2,3]" })],
    );
    expect(result.balances[1]).toBe(1000);
    expect(result.balances[2]).toBe(-500);
    expect(result.balances[3]).toBe(-500);
    expect(result.transfers).toHaveLength(2);
  });

  it("全員が自分の分だけ払っている場合 → 転送なし", () => {
    const payments = members.map((m) =>
      makePayment({ payerId: m.id, amount: 900, splitMemberIds: "[1,2,3]" }),
    );
    const result = calculateSettlement(members, payments);
    expect(result.transfers).toHaveLength(0);
    members.forEach((m) => expect(result.balances[m.id]).toBe(0));
  });

  it("0円の転送は出力しない", () => {
    const result = calculateSettlement(members, []);
    expect(result.transfers).toHaveLength(0);
  });

  it("プロパティ: 残高の合計は厳密に0、転送数は n-1 以下", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };

    for (let trial = 0; trial < 100; trial++) {
      const n = 2 + Math.floor(rand() * 8);
      const memberList = Array.from({ length: n }, (_, k) => ({
        id: k + 1,
        name: `member${k + 1}`,
      }));

      const payments: Payment[] = [];
      const paymentCount = 1 + Math.floor(rand() * 10);
      for (let p = 0; p < paymentCount; p++) {
        const payerId = 1 + Math.floor(rand() * n);
        const participantCount = 1 + Math.floor(rand() * n);
        const shuffled = [...memberList].sort(() => rand() - 0.5);
        const participants = shuffled.slice(0, participantCount).map((m) => m.id);
        const amount = 1 + Math.floor(rand() * 100_000);

        const modeRoll = rand();
        if (modeRoll < 0.34) {
          payments.push(
            makePayment({ payerId, amount, splitMemberIds: JSON.stringify(participants) }),
          );
        } else if (modeRoll < 0.67) {
          const weights = Object.fromEntries(
            participants.map((id) => [String(id), 1 + Math.floor(rand() * 5)]),
          );
          payments.push(
            makePayment({
              payerId,
              amount,
              splitMemberIds: JSON.stringify(participants),
              splitMode: "ratio",
              splitDetails: JSON.stringify(weights),
            }),
          );
        } else {
          // amount モード: 合計が amount に一致する内訳を作る
          const sharesMapEntries: Array<[string, number]> = [];
          let remaining = amount;
          participants.forEach((id, idx) => {
            const share =
              idx === participants.length - 1
                ? remaining
                : Math.floor(rand() * (remaining + 1));
            remaining -= share;
            sharesMapEntries.push([String(id), share]);
          });
          payments.push(
            makePayment({
              payerId,
              amount,
              splitMemberIds: JSON.stringify(participants),
              splitMode: "amount",
              splitDetails: JSON.stringify(Object.fromEntries(sharesMapEntries)),
            }),
          );
        }
      }

      const result = calculateSettlement(memberList, payments);
      const balanceSum = Object.values(result.balances).reduce((a, b) => a + b, 0);
      expect(balanceSum).toBe(0);
      expect(result.transfers.length).toBeLessThanOrEqual(n - 1);
      result.transfers.forEach((t) => {
        expect(t.amount).toBeGreaterThan(0);
        expect(Number.isInteger(t.amount)).toBe(true);
      });
    }
  });
});
