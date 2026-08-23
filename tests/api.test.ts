import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, ADMIN_HEADERS, type TestApp } from "./helpers/app";

async function createEvent(
  ctx: TestApp,
  overrides: Partial<{
    name: string;
    keyword: string;
    memberNames: string[];
    type: string;
  }> = {},
) {
  const res = await request(ctx.app)
    .post("/api/events")
    .send({
      name: "テストイベント",
      keyword: `keyword-${Math.floor(Math.random() * 1e9)}`,
      memberNames: ["田中", "鈴木", "佐藤"],
      ...overrides,
    });
  return res;
}

describe("イベント作成 (POST /api/events)", () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("正常系: 201 でイベントとメンバーを返す", async () => {
    const res = await createEvent(ctx, { keyword: "okinawa2026" });
    expect(res.status).toBe(201);
    expect(res.body.event.keyword).toBe("okinawa2026");
    expect(res.body.event.type).toBe("other");
    expect(res.body.members).toHaveLength(3);
  });

  it("合言葉の重複は 409", async () => {
    await createEvent(ctx, { keyword: "dup-keyword" });
    const res = await createEvent(ctx, { keyword: "dup-keyword" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("その合言葉はすでに使われています");
  });

  it("メンバー名の重複は 400", async () => {
    const res = await createEvent(ctx, { memberNames: ["田中", "田中"] });
    expect(res.status).toBe(400);
  });

  it("メンバー2人未満は 400", async () => {
    const res = await createEvent(ctx, { memberNames: ["田中"] });
    expect(res.status).toBe(400);
  });

  it("UNIQUE 制約がレース時のバックストップになる（storage 直呼び）", async () => {
    const base = {
      name: "e",
      type: "other",
      startDate: null,
      endDate: null,
      createdAt: new Date().toISOString(),
      isSettled: false,
    };
    await ctx.storage.createEvent({ ...base, keyword: "race-kw" });
    await expect(ctx.storage.createEvent({ ...base, keyword: "race-kw" })).rejects.toThrow(
      /UNIQUE constraint failed/,
    );
  });
});

describe("イベント参加 (POST /api/events/join)", () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("正しい合言葉でイベントとメンバーを返す", async () => {
    await createEvent(ctx, { keyword: "join-me" });
    const res = await request(ctx.app).post("/api/events/join").send({ keyword: "join-me" });
    expect(res.status).toBe(200);
    expect(res.body.event.keyword).toBe("join-me");
    expect(res.body.members).toHaveLength(3);
  });

  it("存在しない合言葉は 404", async () => {
    const res = await request(ctx.app).post("/api/events/join").send({ keyword: "no-such" });
    expect(res.status).toBe(404);
  });

  it("合言葉なしは 400", async () => {
    const res = await request(ctx.app).post("/api/events/join").send({});
    expect(res.status).toBe(400);
  });
});

describe("支払い (POST /api/events/:id/payments)", () => {
  let ctx: TestApp;
  let eventId: number;
  let memberIds: number[];

  beforeEach(async () => {
    ctx = await createTestApp();
    const res = await createEvent(ctx);
    eventId = res.body.event.id;
    memberIds = res.body.members.map((m: { id: number }) => m.id);
  });

  it("equal モード: 201 で作成される", async () => {
    const res = await request(ctx.app)
      .post(`/api/events/${eventId}/payments`)
      .send({
        payerId: memberIds[0],
        amount: 3000,
        description: "ランチ",
        splitMemberIds: memberIds,
      });
    expect(res.status).toBe(201);
    expect(res.body.splitMode).toBe("equal");
  });

  it("ratio モード: weights 付きで作成される", async () => {
    const res = await request(ctx.app)
      .post(`/api/events/${eventId}/payments`)
      .send({
        payerId: memberIds[0],
        amount: 1000,
        description: "タクシー",
        splitMode: "ratio",
        splitMemberIds: [memberIds[0], memberIds[1]],
        weights: { [memberIds[0]]: 2, [memberIds[1]]: 1 },
      });
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body.splitDetails)).toEqual({
      [String(memberIds[0])]: 2,
      [String(memberIds[1])]: 1,
    });
  });

  it("amount モード: 内訳合計が金額と一致しなければ 400", async () => {
    const res = await request(ctx.app)
      .post(`/api/events/${eventId}/payments`)
      .send({
        payerId: memberIds[0],
        amount: 1000,
        description: "夕食",
        splitMode: "amount",
        splitMemberIds: [memberIds[0], memberIds[1]],
        amounts: { [memberIds[0]]: 700, [memberIds[1]]: 400 },
      });
    expect(res.status).toBe(400);
  });

  it("メンバー外の payer は 400", async () => {
    const res = await request(ctx.app)
      .post(`/api/events/${eventId}/payments`)
      .send({
        payerId: 99999,
        amount: 1000,
        description: "x",
        splitMemberIds: memberIds,
      });
    expect(res.status).toBe(400);
  });

  it("精算済みイベントへの追加は 400", async () => {
    await request(ctx.app).post(`/api/events/${eventId}/settle`).send({});
    const res = await request(ctx.app)
      .post(`/api/events/${eventId}/payments`)
      .send({
        payerId: memberIds[0],
        amount: 1000,
        description: "x",
        splitMemberIds: memberIds,
      });
    expect(res.status).toBe(400);
  });

  it("存在しないイベントは 404", async () => {
    const res = await request(ctx.app)
      .post("/api/events/99999/payments")
      .send({
        payerId: 1,
        amount: 1000,
        description: "x",
        splitMemberIds: [1],
      });
    expect(res.status).toBe(404);
  });
});

describe("精算 (GET /api/events/:id/settlement)", () => {
  it("E2E: 支払い2件 → 残高合計0で正しい転送", async () => {
    const ctx = await createTestApp();
    const created = await createEvent(ctx);
    const eventId = created.body.event.id;
    const [a, b, c] = created.body.members.map((m: { id: number }) => m.id);

    // A が 3000 円を全員分、B が 1500 円を B・C 分
    await request(ctx.app).post(`/api/events/${eventId}/payments`).send({
      payerId: a,
      amount: 3000,
      description: "宿",
      splitMemberIds: [a, b, c],
    });
    await request(ctx.app)
      .post(`/api/events/${eventId}/payments`)
      .send({
        payerId: b,
        amount: 1500,
        description: "電車",
        splitMemberIds: [b, c],
      });

    const res = await request(ctx.app).get(`/api/events/${eventId}/settlement`);
    expect(res.status).toBe(200);

    const balances: Record<string, number> = res.body.balances;
    const total = Object.values(balances).reduce((acc, v) => acc + v, 0);
    expect(total).toBe(0);
    // A: +3000-1000=+2000, B: +1500-1000-750=-250, C: -1000-750=-1750
    expect(balances[String(a)]).toBe(2000);
    expect(balances[String(b)]).toBe(-250);
    expect(balances[String(c)]).toBe(-1750);
    expect(res.body.transfers.length).toBeLessThanOrEqual(2);
  });
});

describe("管理 API", () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("認証ヘッダなしは 401", async () => {
    const res = await request(ctx.app).get("/api/admin/events");
    expect(res.status).toBe(401);
  });

  it("正しい認証で全イベント + メンバーを返す（N+1 修正のリグレッションガード）", async () => {
    await createEvent(ctx, { keyword: "admin-a" });
    await createEvent(ctx, { keyword: "admin-b", memberNames: ["山田", "高橋"] });

    const res = await request(ctx.app).get("/api/admin/events").set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const byKeyword = Object.fromEntries(
      res.body.map((e: { keyword: string; members: unknown[] }) => [e.keyword, e.members]),
    );
    expect(byKeyword["admin-a"]).toHaveLength(3);
    expect(byKeyword["admin-b"]).toHaveLength(2);
  });

  it("イベント削除はメンバー・支払いをカスケード削除する", async () => {
    const created = await createEvent(ctx, { keyword: "cascade" });
    const eventId = created.body.event.id;
    const memberIds = created.body.members.map((m: { id: number }) => m.id);
    await request(ctx.app).post(`/api/events/${eventId}/payments`).send({
      payerId: memberIds[0],
      amount: 1000,
      description: "x",
      splitMemberIds: memberIds,
    });

    const del = await request(ctx.app)
      .delete(`/api/admin/events/${eventId}`)
      .set(ADMIN_HEADERS);
    expect(del.status).toBe(200);

    expect(await ctx.storage.getEvent(eventId)).toBeUndefined();
    expect(await ctx.storage.getMembersByEvent(eventId)).toHaveLength(0);
    expect(await ctx.storage.getPaymentsByEvent(eventId)).toHaveLength(0);
  });
});

describe("精算の取り消し (POST /api/events/:id/unsettle)", () => {
  let ctx: TestApp;
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it("管理者認証なしで取り消せて、支払いの追加が再びできるようになる", async () => {
    const created = await createEvent(ctx, { keyword: "unsettle-flow" });
    const eventId = created.body.event.id;
    const memberIds = created.body.members.map((m: { id: number }) => m.id);

    await request(ctx.app).post(`/api/events/${eventId}/settle`);

    // 精算済みの間は支払いを足せない。
    const blocked = await request(ctx.app).post(`/api/events/${eventId}/payments`).send({
      payerId: memberIds[0],
      amount: 1000,
      description: "駐車場代",
      splitMemberIds: memberIds,
    });
    expect(blocked.status).toBe(400);

    // 管理者ヘッダを付けずに取り消せる。
    const unsettled = await request(ctx.app).post(`/api/events/${eventId}/unsettle`);
    expect(unsettled.status).toBe(200);
    expect(unsettled.body.isSettled).toBe(false);

    // 取り消したあとは追加できる（復旧が実際に効いていることの確認）。
    const allowed = await request(ctx.app).post(`/api/events/${eventId}/payments`).send({
      payerId: memberIds[0],
      amount: 1000,
      description: "駐車場代",
      splitMemberIds: memberIds,
    });
    expect(allowed.status).toBe(201);
  });

  it("存在しないイベントは 404", async () => {
    const res = await request(ctx.app).post("/api/events/999999/unsettle");
    expect(res.status).toBe(404);
  });

  it("不正な ID は 400", async () => {
    const res = await request(ctx.app).post("/api/events/abc/unsettle");
    expect(res.status).toBe(400);
  });
});

describe("受け取り方の希望 (PATCH /api/events/:id/members/:memberId)", () => {
  let ctx: TestApp;
  let eventId: number;
  let memberIds: number[];

  beforeEach(async () => {
    ctx = await createTestApp();
    const created = await createEvent(ctx, { keyword: "payout-pref" });
    eventId = created.body.event.id;
    memberIds = created.body.members.map((m: { id: number }) => m.id);
  });

  it("初期値は null", async () => {
    const res = await request(ctx.app).get(`/api/events/${eventId}/members`);
    expect(res.status).toBe(200);
    for (const member of res.body) {
      expect(member.payoutPreference).toBeNull();
    }
  });

  it("メンバーごとに別々の希望を設定できる", async () => {
    await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${memberIds[0]}`)
      .send({ payoutPreference: "bank" });
    await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${memberIds[1]}`)
      .send({ payoutPreference: "paypay" });
    await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${memberIds[2]}`)
      .send({ payoutPreference: "any" });

    const res = await request(ctx.app).get(`/api/events/${eventId}/members`);
    const byId = Object.fromEntries(
      res.body.map((m: { id: number; payoutPreference: string | null }) => [m.id, m.payoutPreference]),
    );
    expect(byId[memberIds[0]]).toBe("bank");
    expect(byId[memberIds[1]]).toBe("paypay");
    expect(byId[memberIds[2]]).toBe("any");
  });

  it("null を送ると未設定に戻る", async () => {
    await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${memberIds[0]}`)
      .send({ payoutPreference: "cash" });

    const cleared = await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${memberIds[0]}`)
      .send({ payoutPreference: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.payoutPreference).toBeNull();
  });

  it("未知の値は 400", async () => {
    const res = await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${memberIds[0]}`)
      .send({ payoutPreference: "bitcoin" });
    expect(res.status).toBe(400);
  });

  it("別イベントのメンバー ID は 404", async () => {
    const other = await createEvent(ctx, { keyword: "payout-other" });
    const otherMemberId = other.body.members[0].id;

    const res = await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${otherMemberId}`)
      .send({ payoutPreference: "bank" });
    expect(res.status).toBe(404);
  });

  it("精算済みでも変更できる（送金は精算後に発生するため）", async () => {
    await request(ctx.app).post(`/api/events/${eventId}/settle`);

    const res = await request(ctx.app)
      .patch(`/api/events/${eventId}/members/${memberIds[0]}`)
      .send({ payoutPreference: "bank" });
    expect(res.status).toBe(200);
    expect(res.body.payoutPreference).toBe("bank");
  });
});

describe("受け取り方の希望 — 不正な ID", () => {
  let ctx: TestApp;
  let eventId: number;

  beforeEach(async () => {
    ctx = await createTestApp();
    const created = await createEvent(ctx, { keyword: "payout-badid" });
    eventId = created.body.event.id;
  });

  it("負の memberId（クライアントの楽観更新が使う仮 ID）は 400", async () => {
    const res = await request(ctx.app)
      .patch(`/api/events/${eventId}/members/-1750000000000`)
      .send({ payoutPreference: "bank" });
    expect(res.status).toBe(400);
  });

  it("memberId が 0 は 400", async () => {
    const res = await request(ctx.app)
      .patch(`/api/events/${eventId}/members/0`)
      .send({ payoutPreference: "bank" });
    expect(res.status).toBe(400);
  });

  it("数値でない memberId は 400", async () => {
    const res = await request(ctx.app)
      .patch(`/api/events/${eventId}/members/abc`)
      .send({ payoutPreference: "bank" });
    expect(res.status).toBe(400);
  });
});

describe("比率の重みの検証 (POST /api/events/:id/payments)", () => {
  let ctx: TestApp;
  let eventId: number;
  let memberIds: number[];

  beforeEach(async () => {
    ctx = await createTestApp();
    const created = await createEvent(ctx, { keyword: "weight-guard" });
    eventId = created.body.event.id;
    memberIds = created.body.members.map((m: { id: number }) => m.id);
  });

  const post = (weights: Record<string, number>) =>
    request(ctx.app).post(`/api/events/${eventId}/payments`).send({
      payerId: memberIds[0],
      amount: 3000,
      description: "宿泊費",
      splitMemberIds: [memberIds[0], memberIds[1]],
      splitMode: "ratio",
      weights,
    });

  it("巨大な重み（1e308）は 400 で弾く", async () => {
    const res = await post({ [memberIds[0]]: 1e308, [memberIds[1]]: 1 });
    expect(res.status).toBe(400);
  });

  it("上限（1000）を超える重みは 400 で弾く", async () => {
    const res = await post({ [memberIds[0]]: 1001, [memberIds[1]]: 1 });
    expect(res.status).toBe(400);
  });

  it("上限ちょうどの重みは通る", async () => {
    const res = await post({ [memberIds[0]]: 1000, [memberIds[1]]: 1 });
    expect(res.status).toBe(201);
  });

  it("巨大な重みを弾いたあとも精算が応答する（無限ループの回帰ガード）", async () => {
    await post({ [memberIds[0]]: 1e308, [memberIds[1]]: 1 });
    const res = await request(ctx.app).get(`/api/events/${eventId}/settlement`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.transfers)).toBe(true);
  }, 5000);
});
