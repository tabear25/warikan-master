import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import { type Server } from "http";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  storage as defaultStorage,
  PartialSettlementConflictError,
  PaymentSettledEarlyError,
  type IStorage,
} from "./storage";
import { verifyAdminCredentials } from "./auth";
import { calculateSettlementWithPartials, summarizePartialSettlement } from "./settlement";
import { fetchOgpMetadata, OgpFetchError } from "./ogp";
import {
  LIMITS,
  createEventInputSchema,
  updateEventInputSchema,
  updateMemberInputSchema,
  paymentInputSchema,
  partialSettlementInputSchema,
  scheduleItemInputSchema,
  ogpRequestSchema,
  type PartialSettlement,
  type Payment,
  type PaymentInput,
  type InsertPayment,
  type InsertEvent,
  type InsertScheduleItem,
  type ScheduleItem,
  type ScheduleItemInput,
} from "@shared/schema";

const adminLoginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

// vitest（NODE_ENV=test）ではレート制限を無効化し、テストが 429 で落ちないようにする。
const skipInTest = () => process.env.NODE_ENV === "test";

// 管理者ログインのブルートフォース対策。失敗のみカウントし、1分あたり5回まで。
const adminLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  // オブジェクトを渡すと JSON で返る — 全 API のエラー形状 { error } に合わせる。
  message: { error: "ログイン試行が多すぎます。しばらく待ってから再度お試しください。" },
});

// 一般エンドポイントの濫用対策。作成・参加・支払い系に緩めの制限をかける。
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "リクエストが多すぎます。しばらく待ってから再度お試しください。" },
});

// 合言葉は実質的にイベントへのアクセス資格情報なので、総当たり推測を
// 一般の書き込みより厳しく制限する。
// 成功はカウントしない（adminLoginLimiter と同じ方針）。会場やホテルの Wi-Fi、
// キャリア NAT では参加者全員が同一 IP に見えるため、成功も数えると
// 「その場で全員が参加する」という本来の使い方で上限に当たってしまう。
// 総当たり対策としては失敗回数だけ数えれば足りる。
const joinLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 15,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "合言葉の入力を短時間に繰り返しています。しばらく待ってから再度お試しください。" },
});

// 読み取り系（GET /api/*）の一括制限。通常利用では届かない緩い上限で、
// スクレイピング・列挙系の濫用だけを弾く。
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => skipInTest() || req.method !== "GET",
  message: { error: "リクエストが多すぎます。しばらく待ってから再度お試しください。" },
});

// 管理 API はリクエスト毎に bcrypt 比較が走るため、CPU 濫用を防ぐ上限を設ける
// （ログインの 5 回/分とは別に、認証済み運用でも困らない値）。
const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "リクエストが多すぎます。しばらく待ってから再度お試しください。" },
});

// OGP 取得の濫用対策（要件 N-Sec-3: IP あたり 1 分 30 回）。外部サイトへの
// フェッチを伴うため、一般の書き込み系より厳しめに制限する。
const ogpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "リクエストが多すぎます。しばらく待ってから再度お試しください。" },
});

const updateSettlementStatusSchema = z.object({
  isSettled: z.boolean(),
});

const memberNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "メンバー名を入力してください")
    .max(LIMITS.memberName, `メンバー名は${LIMITS.memberName}文字以内で入力してください`),
});

// PaymentInput を DB 行（InsertPayment の一部）に変換する。
function paymentInputToFields(input: PaymentInput): Omit<InsertPayment, "eventId" | "createdAt"> {
  let splitDetails: string | null = null;
  if (input.splitMode === "ratio") {
    splitDetails = JSON.stringify(input.weights);
  } else if (input.splitMode === "amount") {
    splitDetails = JSON.stringify(input.amounts);
  }

  return {
    payerId: input.payerId,
    amount: input.amount,
    description: input.description,
    splitMemberIds: JSON.stringify(input.splitMemberIds),
    splitMode: input.splitMode,
    splitDetails,
  };
}

// payer / split 対象がすべてイベントのメンバーかを検証する。
async function validatePaymentMembers(
  storage: IStorage,
  eventId: number,
  input: PaymentInput,
): Promise<string | null> {
  const eventMembers = await storage.getMembersByEvent(eventId);
  const memberIds = new Set(eventMembers.map((member) => member.id));

  if (!memberIds.has(input.payerId)) {
    return "支払った人がこのイベントのメンバーではありません";
  }
  if (input.splitMemberIds.some((memberId) => !memberIds.has(memberId))) {
    return "割り勘の対象はこのイベントのメンバーである必要があります";
  }
  return null;
}

// ScheduleItemInput を DB 行（InsertScheduleItem の一部）に変換する。
// undefined は明示的に null へ落とす（PATCH でフィールドをクリアできるように）。
function scheduleInputToFields(
  input: ScheduleItemInput,
): Omit<InsertScheduleItem, "eventId" | "createdAt" | "updatedAt" | "paymentId"> {
  return {
    category: input.category,
    title: input.title,
    url: input.url ?? null,
    ogpTitle: input.ogpTitle ?? null,
    ogpImage: input.ogpImage ?? null,
    ogpDescription: input.ogpDescription ?? null,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    address: input.address ?? null,
    memo: input.memo ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    cost: input.cost ?? null,
    payerId: input.payerId ?? null,
  };
}

// スケジュール項目の支払者（任意）がイベントのメンバーかを検証する。
async function validateSchedulePayer(
  storage: IStorage,
  eventId: number,
  payerId: number | undefined,
): Promise<string | null> {
  if (payerId === undefined) return null;
  const eventMembers = await storage.getMembersByEvent(eventId);
  if (!eventMembers.some((member) => member.id === payerId)) {
    return "支払者はこのイベントのメンバーである必要があります";
  }
  return null;
}

// storage はテストから :memory: DB を注入できるよう引数で差し替え可能にする。
export async function registerRoutes(
  httpServer: Server,
  app: Express,
  storage: IStorage = defaultStorage,
): Promise<Server> {
  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    const adminUsername = req.headers["x-admin-username"];
    const adminPassword = req.headers["x-admin-password"];

    if (!adminUsername || !adminPassword) {
      return res.status(401).json({ error: "Admin credentials are required" });
    }

    const valid = await verifyAdminCredentials(String(adminUsername), String(adminPassword));
    if (!valid) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    next();
  };

  // 管理ルート共通ガード: レート制限（bcrypt 比較の CPU 濫用対策）+ 認証。
  const adminGuard: RequestHandler[] = [adminApiLimiter, requireAdmin];

  // GET 全体の一括レート制限（POST/PATCH/DELETE は各 limiter が担当）。
  app.use("/api", readLimiter);

  app.post("/api/admin/login", adminLoginLimiter, async (req, res) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "Invalid request body" });
    }

    const { username, password } = parsed.data;
    const valid = await verifyAdminCredentials(username, password);
    if (!valid) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }

    return res.json({ success: true, admin: { username } });
  });

  app.get("/api/admin/events", adminGuard, async (_req: Request, res: Response) => {
    // イベント毎にメンバーを取りに行く N+1 を避け、2クエリでまとめて取得する
    // （本番はリモートの Turso なので往復回数がそのままレイテンシになる）。
    const allEvents = await storage.getAllEvents();
    const allMembers = await storage.getMembersByEventIds(allEvents.map((event) => event.id));
    const membersByEvent = new Map<number, typeof allMembers>();
    for (const member of allMembers) {
      const list = membersByEvent.get(member.eventId);
      if (list) {
        list.push(member);
      } else {
        membersByEvent.set(member.eventId, [member]);
      }
    }

    const eventsWithMembers = allEvents.map((event) => ({
      ...event,
      members: membersByEvent.get(event.id) ?? [],
    }));

    return res.json(eventsWithMembers);
  });

  app.patch("/api/admin/events/:id/settlement", adminGuard, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const parsed = updateSettlementStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    const event = await storage.updateEventSettlementStatus(id, parsed.data.isSettled);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json(event);
  });

  app.post("/api/admin/events/:id/members", adminGuard, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const parsed = memberNameSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const normalizedName = parsed.data.name;
    const eventMembers = await storage.getMembersByEvent(id);
    if (eventMembers.length >= LIMITS.maxMembers) {
      return res.status(400).json({ error: `メンバーは${LIMITS.maxMembers}人までです` });
    }
    const duplicateMember = eventMembers.find((member) => member.name === normalizedName);
    if (duplicateMember) {
      return res.status(409).json({ error: "同じ名前のメンバーがすでに存在します" });
    }

    const member = await storage.createMember({ eventId: id, name: normalizedName });
    return res.status(201).json(member);
  });

  app.delete("/api/admin/events/:id/members/:memberId", adminGuard, async (req: Request, res: Response) => {
    const eventId = parseInt(String(req.params.id), 10);
    const memberId = parseInt(String(req.params.memberId), 10);

    if (isNaN(eventId) || isNaN(memberId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const event = await storage.getEvent(eventId);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const member = await storage.getMember(memberId);
    if (!member || member.eventId !== eventId) {
      return res.status(404).json({ error: "Member not found" });
    }

    const eventMembers = await storage.getMembersByEvent(eventId);
    if (eventMembers.length <= 2) {
      return res.status(400).json({ error: "At least two members are required" });
    }

    const eventPayments = await storage.getPaymentsByEvent(eventId);
    const isMemberReferenced = eventPayments.some((payment) => {
      if (payment.payerId === memberId) {
        return true;
      }

      try {
        const splitMemberIds: number[] = JSON.parse(payment.splitMemberIds);
        return splitMemberIds.includes(memberId);
      } catch {
        return false;
      }
    });

    if (isMemberReferenced) {
      return res.status(400).json({ error: "This member is referenced by existing payments and cannot be deleted" });
    }

    await storage.deleteMember(memberId);
    return res.json({ success: true });
  });

  app.delete("/api/admin/events/:id", adminGuard, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    await storage.deleteEvent(id);
    return res.json({ success: true });
  });

  app.post("/api/events", writeLimiter, async (req, res) => {
    const parsed = createEventInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { name, keyword, memberNames, type, startDate, endDate } = parsed.data;

    // 同一イベント内の重複メンバー名を拒否する。
    const uniqueNames = new Set(memberNames);
    if (uniqueNames.size !== memberNames.length) {
      return res.status(400).json({ error: "メンバー名が重複しています" });
    }

    const existing = await storage.getEventByKeyword(keyword);
    if (existing) {
      return res.status(409).json({ error: "その合言葉はすでに使われています" });
    }

    let event;
    try {
      event = await storage.createEvent({
        name,
        keyword,
        // type 未指定（旧クライアント含む）は従来どおりの 'other' として扱う。
        type: type ?? "other",
        startDate: startDate ?? null,
        endDate: endDate ?? null,
        createdAt: new Date().toISOString(),
        isSettled: false,
      });
    } catch (err) {
      // 事前チェックとの間のレースは DB の UNIQUE 制約で捕捉する。
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("UNIQUE constraint failed") || message.includes("SQLITE_CONSTRAINT")) {
        return res.status(409).json({ error: "その合言葉はすでに使われています" });
      }
      throw err;
    }

    const createdMembers = await Promise.all(
      memberNames.map((memberName) => storage.createMember({ eventId: event.id, name: memberName })),
    );

    return res.status(201).json({ event, members: createdMembers });
  });

  app.post("/api/events/join", joinLimiter, async (req, res) => {
    const parsed = z
      .object({
        keyword: z
          .string({ required_error: "合言葉を入力してください" })
          .trim()
          .min(1, "合言葉を入力してください")
          .max(LIMITS.keyword, `合言葉は${LIMITS.keyword}文字以内で入力してください`),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const event = await storage.getEventByKeyword(parsed.data.keyword);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const eventMembers = await storage.getMembersByEvent(event.id);
    return res.json({ event, members: eventMembers });
  });

  app.get("/api/events/:id", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json(event);
  });

  // イベントのタイプ・期間を変更する（合言葉モデルに合わせて参加者は誰でも変更可）。
  app.patch("/api/events/:id", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.isSettled) {
      return res.status(400).json({ error: "精算済みのイベントは編集できません" });
    }

    const parsed = updateEventInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const fields: Partial<Pick<InsertEvent, "type" | "startDate" | "endDate">> = {};
    if (parsed.data.type !== undefined) fields.type = parsed.data.type;
    if (parsed.data.startDate !== undefined) fields.startDate = parsed.data.startDate;
    if (parsed.data.endDate !== undefined) fields.endDate = parsed.data.endDate;

    if (Object.keys(fields).length === 0) {
      return res.json(event);
    }

    const updated = await storage.updateEventMeta(id, fields);
    return res.json(updated);
  });

  app.get("/api/events/:id/members", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const eventMembers = await storage.getMembersByEvent(id);
    return res.json(eventMembers);
  });

  // 一般ユーザーがイベント作成後にメンバーを追加できる（精算前のみ）。
  app.post("/api/events/:id/members", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.isSettled) {
      return res.status(400).json({ error: "精算済みのイベントにはメンバーを追加できません" });
    }

    const parsed = memberNameSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const normalizedName = parsed.data.name;
    const eventMembers = await storage.getMembersByEvent(id);
    if (eventMembers.length >= LIMITS.maxMembers) {
      return res.status(400).json({ error: `メンバーは${LIMITS.maxMembers}人までです` });
    }
    if (eventMembers.some((member) => member.name === normalizedName)) {
      return res.status(409).json({ error: "同じ名前のメンバーがすでに存在します" });
    }

    const member = await storage.createMember({ eventId: id, name: normalizedName });
    return res.status(201).json(member);
  });

  // 受け取り方の希望の設定。合言葉を知っている人なら誰でも変更できる（このアプリは
  // 端末とメンバーを結びつけないので、本人だけに限定する手段がない）。保持するのは
  // 手段の種別だけで、口座番号や PayPay ID は保存しない。
  // 精算済みでも変更できる — 送金はむしろ精算後に発生するため。
  app.patch("/api/events/:id/members/:memberId", writeLimiter, async (req, res) => {
    const eventId = parseInt(String(req.params.id), 10);
    const memberId = parseInt(String(req.params.memberId), 10);
    // 負の ID はクライアントの楽観更新が使う仮 ID（AddMemberDialog）。サーバには
    // 存在しないので、404 ではなく 400 で「不正な ID」と切り分けられるようにする。
    if (isNaN(eventId) || isNaN(memberId) || eventId <= 0 || memberId <= 0) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const member = await storage.getMember(memberId);
    if (!member || member.eventId !== eventId) {
      return res.status(404).json({ error: "Member not found" });
    }

    const parsed = updateMemberInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const updated = await storage.updateMember(memberId, {
      payoutPreference: parsed.data.payoutPreference,
    });
    return res.json(updated);
  });

  app.get("/api/events/:id/payments", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const eventPayments = await storage.getPaymentsByEvent(id);
    return res.json(eventPayments);
  });

  app.post("/api/events/:id/payments", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.isSettled) {
      return res.status(400).json({ error: "This event is already settled" });
    }

    // スケジュール項目からの変換（任意）: scheduleItemId が来たら検証して双方向リンクする。
    let scheduleItem: ScheduleItem | null = null;
    const rawScheduleItemId = (req.body as Record<string, unknown> | undefined)?.scheduleItemId;
    if (rawScheduleItemId !== undefined && rawScheduleItemId !== null) {
      const idParse = z.number().int().positive().safeParse(rawScheduleItemId);
      if (!idParse.success) {
        return res.status(400).json({ error: "scheduleItemId が不正です" });
      }
      const item = await storage.getScheduleItem(idParse.data);
      if (!item || item.eventId !== id) {
        return res.status(404).json({ error: "スケジュール項目が見つかりません" });
      }
      if (item.paymentId != null) {
        return res.status(409).json({ error: "この項目はすでに割り勘に追加されています" });
      }
      scheduleItem = item;
    }

    // 旧クライアント互換: splitMode 未指定なら equal を補う。
    const body = { splitMode: "equal", ...req.body };
    const parsed = paymentInputSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const memberError = await validatePaymentMembers(storage, id, parsed.data);
    if (memberError) {
      return res.status(400).json({ error: memberError });
    }

    const paymentFields = {
      eventId: id,
      ...paymentInputToFields(parsed.data),
      createdAt: new Date().toISOString(),
    };

    const payment = scheduleItem
      ? await storage.createPaymentLinkedToScheduleItem(
          { ...paymentFields, scheduleItemId: scheduleItem.id },
          scheduleItem.id,
        )
      : await storage.createPayment(paymentFields);

    return res.status(201).json(payment);
  });

  app.patch("/api/events/:id/payments/:paymentId", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const paymentId = parseInt(String(req.params.paymentId), 10);
    if (isNaN(id) || isNaN(paymentId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.isSettled) {
      return res.status(400).json({ error: "精算済みのイベントは編集できません" });
    }

    const payment = await storage.getPayment(paymentId);
    if (!payment || payment.eventId !== id) {
      return res.status(404).json({ error: "Payment not found" });
    }
    // 先に精算した支払いを変えると、その区切りの送金リスト（すでに送金済みかもしれない）
    // が黙って変わってしまう。変えたいときは区切りを取り消してもらう。
    // ここは早く返すための事前チェックで、競合時は storage 側の条件付き書き込みが止める。
    const settledEarlyEditError =
      "先に精算した支払いは編集できません。変更するには、先に精算した分を取り消してください";
    if (payment.partialSettlementId != null) {
      return res.status(400).json({ error: settledEarlyEditError });
    }

    const body = { splitMode: "equal", ...req.body };
    const parsed = paymentInputSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const memberError = await validatePaymentMembers(storage, id, parsed.data);
    if (memberError) {
      return res.status(400).json({ error: memberError });
    }

    try {
      const updated = await storage.updatePayment(paymentId, paymentInputToFields(parsed.data));
      return res.json(updated);
    } catch (err) {
      if (err instanceof PaymentSettledEarlyError) {
        return res.status(400).json({ error: settledEarlyEditError });
      }
      throw err;
    }
  });

  app.delete("/api/events/:id/payments/:paymentId", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const paymentId = parseInt(String(req.params.paymentId), 10);
    if (isNaN(id) || isNaN(paymentId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.isSettled) {
      return res.status(400).json({ error: "精算済みのイベントは編集できません" });
    }

    const payment = await storage.getPayment(paymentId);
    if (!payment || payment.eventId !== id) {
      return res.status(404).json({ error: "Payment not found" });
    }
    const settledEarlyDeleteError =
      "先に精算した支払いは削除できません。削除するには、先に精算した分を取り消してください";
    if (payment.partialSettlementId != null) {
      return res.status(400).json({ error: settledEarlyDeleteError });
    }

    try {
      await storage.deletePayment(paymentId);
    } catch (err) {
      if (err instanceof PaymentSettledEarlyError) {
        return res.status(400).json({ error: settledEarlyDeleteError });
      }
      throw err;
    }
    return res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // スケジュール（旅行の宿泊・移動・その他予約）
  // 割り勘とは独立に動くサブ機能。精算済みイベントでも旅程の追記・編集は可能
  // （ロックされるのは支払い側だけ。割り勘への変換は payments 側の精算チェックで弾かれる）。
  // ---------------------------------------------------------------------------
  app.get("/api/events/:id/schedule", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const items = await storage.getScheduleItemsByEvent(id);
    return res.json(items);
  });

  app.post("/api/events/:id/schedule", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const existingItems = await storage.getScheduleItemsByEvent(id);
    if (existingItems.length >= LIMITS.maxScheduleItems) {
      return res.status(400).json({ error: `スケジュールは${LIMITS.maxScheduleItems}件までです` });
    }

    const parsed = scheduleItemInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const payerError = await validateSchedulePayer(storage, id, parsed.data.payerId);
    if (payerError) {
      return res.status(400).json({ error: payerError });
    }

    const now = new Date().toISOString();
    const item = await storage.createScheduleItem({
      eventId: id,
      ...scheduleInputToFields(parsed.data),
      paymentId: null,
      createdAt: now,
      updatedAt: now,
    });

    return res.status(201).json(item);
  });

  app.patch("/api/events/:id/schedule/:itemId", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const itemId = parseInt(String(req.params.itemId), 10);
    if (isNaN(id) || isNaN(itemId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const item = await storage.getScheduleItem(itemId);
    if (!item || item.eventId !== id) {
      return res.status(404).json({ error: "スケジュール項目が見つかりません" });
    }

    const parsed = scheduleItemInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const payerError = await validateSchedulePayer(storage, id, parsed.data.payerId);
    if (payerError) {
      return res.status(400).json({ error: payerError });
    }

    const updated = await storage.updateScheduleItem(itemId, {
      ...scheduleInputToFields(parsed.data),
      updatedAt: new Date().toISOString(),
    });

    return res.json(updated);
  });

  app.delete("/api/events/:id/schedule/:itemId", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const itemId = parseInt(String(req.params.itemId), 10);
    if (isNaN(id) || isNaN(itemId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const item = await storage.getScheduleItem(itemId);
    if (!item || item.eventId !== id) {
      return res.status(404).json({ error: "スケジュール項目が見つかりません" });
    }

    await storage.deleteScheduleItem(itemId);
    return res.json({ success: true });
  });

  // URL の OGP メタデータを取得する（スケジュール項目のタイトル・画像の自動補完用）。
  app.post("/api/ogp", ogpLimiter, async (req, res) => {
    const parsed = ogpRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    try {
      const result = await fetchOgpMetadata(parsed.data.url);
      return res.json(result);
    } catch (err) {
      if (err instanceof OgpFetchError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("OGP fetch error:", err);
      return res.status(502).json({ error: "OGP の取得に失敗しました" });
    }
  });

  app.get("/api/events/:id/settlement", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // 3つは互いに依存しないので並べて取る（本番はリモートの Turso なので往復がそのまま遅延になる）。
    const [eventMembers, eventPayments, eventPartials] = await Promise.all([
      storage.getMembersByEvent(id),
      storage.getPaymentsByEvent(id),
      storage.getPartialSettlementsByEvent(id),
    ]);
    // transfers / balances は「残り（未精算分）」で、先に精算した分は partialSettlements に
    // 区切りごとに入る。部分精算の無いイベントでは従来どおり全支払いの精算になる
    // （モバイル版は transfers / balances だけを読むので、そのまま動く）。
    const result = calculateSettlementWithPartials(eventMembers, eventPayments, eventPartials);

    return res.json(result);
  });

  // 部分精算（例: 3か月先の旅行で、ホテル代と飛行機代だけ先に精算する）。
  // 選んだ支払いだけで送金リストを作り、それらを「先に精算済み」にする。含めた支払いは
  // 残りの精算から外れ、区切りを取り消すまで編集・削除できない。イベント自体は
  // ロックしないので、旅行中の支払いはこれまでどおり追加できる。
  // 誰が操作できるかは settle / unsettle と同じく合言葉モデル（管理者認証なし）。
  app.post("/api/events/:id/partial-settlements", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.isSettled) {
      return res.status(400).json({ error: "精算済みのイベントでは部分精算できません" });
    }

    const parsed = partialSettlementInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    // 重複を除いておく（storage 側で更新件数と突き合わせるため）。
    const paymentIds = Array.from(new Set(parsed.data.paymentIds));
    // メンバーは作成より前に取っておく。コミット後の読み取りで失敗すると、区切りは
    // できたのに 500 が返り、やり直すと 409 になってしまうため。
    const [eventPayments, eventMembers] = await Promise.all([
      storage.getPaymentsByEvent(id),
      storage.getMembersByEvent(id),
    ]);
    const paymentsById = new Map(eventPayments.map((payment) => [payment.id, payment]));
    for (const paymentId of paymentIds) {
      const payment = paymentsById.get(paymentId);
      if (!payment) {
        return res.status(404).json({ error: "選んだ支払いが見つかりません。画面を更新してやり直してください" });
      }
      if (payment.partialSettlementId != null) {
        return res.status(409).json({ error: "すでに先に精算した支払いが含まれています" });
      }
    }

    let created: { partial: PartialSettlement; payments: Payment[] };
    try {
      created = await storage.createPartialSettlement(
        { eventId: id, createdAt: new Date().toISOString() },
        paymentIds,
      );
    } catch (err) {
      // 事前チェックとの間に、別の部分精算が同じ支払いを取った場合。
      if (err instanceof PartialSettlementConflictError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }

    // 応答は、実際に区切りに入った内容（トランザクション内で読み直した支払い）から組み立てる。
    return res
      .status(201)
      .json(summarizePartialSettlement(eventMembers, created.partial, created.payments));
  });

  // 部分精算の取り消し。含めていた支払いは未精算に戻り、残りの精算に合算される。
  // イベント全体が精算済みの間は取り消せない（締めた送金リストが黙って変わるため）。
  app.delete("/api/events/:id/partial-settlements/:partialId", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    const partialId = parseInt(String(req.params.partialId), 10);
    if (isNaN(id) || isNaN(partialId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const event = await storage.getEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.isSettled) {
      return res.status(400).json({
        error: "精算済みのイベントでは部分精算を取り消せません。先に精算を取り消してください",
      });
    }

    const partial = await storage.getPartialSettlement(partialId);
    if (!partial || partial.eventId !== id) {
      return res.status(404).json({ error: "部分精算が見つかりません" });
    }

    await storage.deletePartialSettlement(partialId, id);
    return res.json({ success: true });
  });

  app.post("/api/events/:id/settle", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.settleEvent(id);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json(event);
  });

  // 精算の取り消し。「精算する」を誰でも押せるのに戻すのは管理者だけ、という
  // 非対称を解消するための一般ルート。誤タップで支払いの追加・編集・削除まで
  // 止まってしまい、開発者に連絡する以外の復旧手段がなかった。
  // 管理者向けの PATCH /api/admin/events/:id/settlement は運用用に残してある。
  app.post("/api/events/:id/unsettle", writeLimiter, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const event = await storage.updateEventSettlementStatus(id, false);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    return res.json(event);
  });

  return httpServer;
}
