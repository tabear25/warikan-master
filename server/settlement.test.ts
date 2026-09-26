import { describe, it, expect } from "vitest";
import type { Payment } from "@shared/schema";
import { computeShares, calculateSettlement, calculateSettlementWithPartials } from "./settlement";

let paymentId = 0;

function makePayment(overrides: Partial<Payment> & Pick<Payment, "payerId" | "amount" | "splitMemberIds">): Payment {
  return {
    id: ++paymentId,
    eventId: 1,
    description: "テスト支払い",
    splitMode: "equal",
    splitDetails: null,
    scheduleItemId: null,
    partialSettlementId: null,
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

describe("calculateSettlementWithPartials（部分精算）", () => {
  const members = [
    { id: 1, name: "田中" },
    { id: 2, name: "鈴木" },
    { id: 3, name: "佐藤" },
    { id: 4, name: "高橋" },
  ];
  const everyone = "[1,2,3,4]";

  it("ホテル代と飛行機代だけ先に精算すると、残りは旅行中の支払いだけで計算される", () => {
    const hotel = makePayment({ payerId: 1, amount: 120_000, splitMemberIds: everyone, description: "ホテル代", partialSettlementId: 10 });
    const flight = makePayment({ payerId: 2, amount: 200_000, splitMemberIds: everyone, description: "飛行機代", partialSettlementId: 10 });
    const dinner = makePayment({ payerId: 3, amount: 12_000, splitMemberIds: everyone, description: "夕食" });

    const result = calculateSettlementWithPartials(members, [hotel, flight, dinner], [
      { id: 10, createdAt: "2026-06-26T10:00:00.000Z" },
    ]);

    expect(result.partialSettlements).toHaveLength(1);
    const [early] = result.partialSettlements;
    expect(early.id).toBe(10);
    expect(early.paymentIds).toEqual([hotel.id, flight.id]);
    expect(early.total).toBe(320_000);
    // 1人あたり ホテル 30,000 + 飛行機 50,000 = 80,000 の負担。
    expect(early.balances).toEqual({ 1: 40_000, 2: 120_000, 3: -80_000, 4: -80_000 });
    expect(early.transfers).toEqual([
      { from: "佐藤", to: "鈴木", amount: 80_000 },
      { from: "高橋", to: "鈴木", amount: 40_000 },
      { from: "高橋", to: "田中", amount: 40_000 },
    ]);

    // 残りは夕食だけ。
    expect(result.balances).toEqual({ 1: -3_000, 2: -3_000, 3: 9_000, 4: -3_000 });
    expect(result.transfers).toEqual([
      { from: "田中", to: "佐藤", amount: 3_000 },
      { from: "鈴木", to: "佐藤", amount: 3_000 },
      { from: "高橋", to: "佐藤", amount: 3_000 },
    ]);
  });

  it("部分精算が無ければ calculateSettlement と同じ結果になる", () => {
    const payments = [
      makePayment({ payerId: 1, amount: 9_000, splitMemberIds: everyone }),
      makePayment({ payerId: 4, amount: 1_001, splitMemberIds: "[2,4]" }),
    ];
    const result = calculateSettlementWithPartials(members, payments, []);
    expect(result.partialSettlements).toEqual([]);
    expect(result.transfers).toEqual(calculateSettlement(members, payments).transfers);
    expect(result.balances).toEqual(calculateSettlement(members, payments).balances);
  });

  it("存在しない区切りを指す支払いは残りに入れる（精算から漏らさない）", () => {
    const orphan = makePayment({ payerId: 1, amount: 4_000, splitMemberIds: everyone, partialSettlementId: 999 });
    const result = calculateSettlementWithPartials(members, [orphan], []);
    expect(result.balances[1]).toBe(3_000);
    expect(result.transfers).toHaveLength(3);
  });

  it("支払いを含まない区切りは合計0・送金なしで返す", () => {
    const result = calculateSettlementWithPartials(members, [], [{ id: 5, createdAt: "2026-06-26T10:00:00.000Z" }]);
    expect(result.partialSettlements).toEqual([
      {
        id: 5,
        createdAt: "2026-06-26T10:00:00.000Z",
        paymentIds: [],
        total: 0,
        transfers: [],
        balances: { 1: 0, 2: 0, 3: 0, 4: 0 },
      },
    ]);
  });

  it("プロパティ: 区切りごとの収支と残りの収支を足すと、一括精算の収支に一致する", () => {
    let seed = 11;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };

    for (let trial = 0; trial < 100; trial++) {
      const n = 2 + Math.floor(rand() * 6);
      const memberList = members.concat(
        Array.from({ length: Math.max(0, n - members.length) }, (_, k) => ({ id: 5 + k, name: `member${5 + k}` })),
      ).slice(0, n);
      const partialIds = [1, 2, 3].slice(0, Math.floor(rand() * 4));

      const payments: Payment[] = [];
      const paymentCount = 1 + Math.floor(rand() * 12);
      for (let p = 0; p < paymentCount; p++) {
        const payerId = memberList[Math.floor(rand() * n)].id;
        const participants = memberList.filter(() => rand() < 0.7).map((m) => m.id);
        if (participants.length === 0) participants.push(payerId);
        const weights = Object.fromEntries(participants.map((id) => [String(id), 1 + Math.floor(rand() * 4)]));
        const roll = Math.floor(rand() * (partialIds.length + 1));
        payments.push(
          makePayment({
            payerId,
            amount: 1 + Math.floor(rand() * 300_000),
            splitMemberIds: JSON.stringify(participants),
            splitMode: rand() < 0.5 ? "equal" : "ratio",
            splitDetails: JSON.stringify(weights),
            partialSettlementId: roll < partialIds.length ? partialIds[roll] : null,
          }),
        );
      }

      const whole = calculateSettlement(memberList, payments);
      const split = calculateSettlementWithPartials(
        memberList,
        payments,
        partialIds.map((id) => ({ id, createdAt: "2026-06-26T10:00:00.000Z" })),
      );

      for (const member of memberList) {
        const summed =
          split.balances[member.id] +
          split.partialSettlements.reduce((acc, partial) => acc + partial.balances[member.id], 0);
        expect(summed).toBe(whole.balances[member.id]);
      }
      // 各区切り・残りとも収支の合計は 0（区切りごとに閉じて精算できる）。
      for (const part of [split, ...split.partialSettlements]) {
        expect(Object.values(part.balances).reduce((a, b) => a + b, 0)).toBe(0);
      }
      // すべての支払いがちょうど1回ずつ、どこかに数えられている。
      const counted = split.partialSettlements.reduce((acc, partial) => acc + partial.paymentIds.length, 0);
      const remainingCount = payments.filter((payment) => payment.partialSettlementId == null).length;
      expect(counted + remainingCount).toBe(payments.length);
    }
  });
});
