import type { Express, NextFunction, Request, Response } from "express";
import { type Server } from "http";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { storage } from "./storage";
import { verifyAdminCredentials } from "./auth";
import { calculateSettlement } from "./settlement";
import { fetchOgpMetadata, OgpFetchError } from "./ogp";
import {
  LIMITS,
  createEventInputSchema,
  updateEventInputSchema,
  paymentInputSchema,
  scheduleItemInputSchema,
  ogpRequestSchema,
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

// 管理者ログインのブルートフォース対策。失敗のみカウントし、1分あたり5回まで。
const adminLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: "ログイン試行が多すぎます。しばらく待ってから再度お試しください。",
});

// 一般エンドポイントの濫用対策。作成・参加・支払い系に緩めの制限をかける。
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: "リクエストが多すぎます。しばらく待ってから再度お試しください。",
});

// OGP 取得の濫用対策（要件 N-Sec-3: IP あたり 1 分 30 回）。外部サイトへの
// フェッチを伴うため、一般の書き込み系より厳しめに制限する。
const ogpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: "リクエストが多すぎます。しばらく待ってから再度お試しください。",
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

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
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

  app.get("/api/admin/events", requireAdmin, async (_req, res) => {
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

  app.patch("/api/admin/events/:id/settlement", requireAdmin, async (req, res) => {
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

  app.post("/api/admin/events/:id/members", requireAdmin, async (req, res) => {
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

  app.delete("/api/admin/events/:id/members/:memberId", requireAdmin, async (req, res) => {
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

  app.delete("/api/admin/events/:id", requireAdmin, async (req, res) => {
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

  app.post("/api/events/join", writeLimiter, async (req, res) => {
    const keyword = typeof req.body?.keyword === "string" ? req.body.keyword.trim() : "";
    if (!keyword) {
      return res.status(400).json({ error: "Keyword is required" });
    }

    const event = await storage.getEventByKeyword(keyword);
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

    const memberError = await validatePaymentMembers(id, parsed.data);
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

    const body = { splitMode: "equal", ...req.body };
    const parsed = paymentInputSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const memberError = await validatePaymentMembers(id, parsed.data);
    if (memberError) {
      return res.status(400).json({ error: memberError });
    }

    const updated = await storage.updatePayment(paymentId, paymentInputToFields(parsed.data));
    return res.json(updated);
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

    await storage.deletePayment(paymentId);
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

    const payerError = await validateSchedulePayer(id, parsed.data.payerId);
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

    const payerError = await validateSchedulePayer(id, parsed.data.payerId);
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

    const eventMembers = await storage.getMembersByEvent(id);
    const eventPayments = await storage.getPaymentsByEvent(id);
    const result = calculateSettlement(eventMembers, eventPayments);

    return res.json(result);
  });

  app.post("/api/events/:id/settle", async (req, res) => {
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

  return httpServer;
}
