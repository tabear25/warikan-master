import type { Express, NextFunction, Request, Response } from "express";
import { type Server } from "http";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { storage } from "./storage";
import { verifyAdminCredentials } from "./auth";
import { calculateSettlement } from "./settlement";
import {
  LIMITS,
  createEventInputSchema,
  paymentInputSchema,
  type PaymentInput,
  type InsertPayment,
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
    const allEvents = await storage.getAllEvents();
    const eventsWithMembers = await Promise.all(
      allEvents.map(async (event) => ({
        ...event,
        members: await storage.getMembersByEvent(event.id),
      })),
    );

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

    const { name, keyword, memberNames } = parsed.data;

    // 同一イベント内の重複メンバー名を拒否する。
    const uniqueNames = new Set(memberNames);
    if (uniqueNames.size !== memberNames.length) {
      return res.status(400).json({ error: "メンバー名が重複しています" });
    }

    const existing = await storage.getEventByKeyword(keyword);
    if (existing) {
      return res.status(409).json({ error: "その合言葉はすでに使われています" });
    }

    const event = await storage.createEvent({
      name,
      keyword,
      createdAt: new Date().toISOString(),
      isSettled: false,
    });

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

    const payment = await storage.createPayment({
      eventId: id,
      ...paymentInputToFields(parsed.data),
      createdAt: new Date().toISOString(),
    });

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
