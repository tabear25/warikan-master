import type { Express, NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { storage } from "./storage";
import { verifyAdminCredentials } from "./auth";

interface Transfer {
  from: string;
  to: string;
  amount: number;
}

interface SettlementResult {
  transfers: Transfer[];
  balances: Record<number, number>;
}

function calculateSettlement(
  memberList: Array<{ id: number; name: string }>,
  paymentList: Array<{ payerId: number; amount: number; splitMemberIds: string }>,
): SettlementResult {
  const balances: Record<number, number> = {};
  memberList.forEach((member) => {
    balances[member.id] = 0;
  });

  for (const payment of paymentList) {
    const splitIds: number[] = JSON.parse(payment.splitMemberIds);
    const share = payment.amount / splitIds.length;

    balances[payment.payerId] = (balances[payment.payerId] ?? 0) + payment.amount;

    for (const memberId of splitIds) {
      balances[memberId] = (balances[memberId] ?? 0) - share;
    }
  }

  const debtors = memberList
    .filter((member) => balances[member.id] < -0.01)
    .map((member) => ({ id: member.id, name: member.name, amount: -balances[member.id] }))
    .sort((left, right) => right.amount - left.amount);

  const creditors = memberList
    .filter((member) => balances[member.id] > 0.01)
    .map((member) => ({ id: member.id, name: member.name, amount: balances[member.id] }))
    .sort((left, right) => right.amount - left.amount);

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0.01) {
      transfers.push({
        from: debtor.name,
        to: creditor.name,
        amount: Math.round(amount * 100) / 100,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount < 0.01) {
      debtorIndex += 1;
    }
    if (creditor.amount < 0.01) {
      creditorIndex += 1;
    }
  }

  return { transfers, balances };
}

const adminLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
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

const createEventSchema = z.object({
  name: z.string().min(1, "Event name is required"),
  keyword: z.string().min(1, "Keyword is required"),
  memberNames: z.array(z.string().min(1)).min(2, "At least two members are required"),
});

const addPaymentSchema = z.object({
  payerId: z.number().int().positive(),
  amount: z.number().positive("Amount must be greater than zero"),
  description: z.string().min(1, "Description is required"),
  splitMemberIds: z.array(z.number().int().positive()).min(1, "At least one split target is required"),
});

const updateSettlementStatusSchema = z.object({
  isSettled: z.boolean(),
});

const addAdminMemberSchema = z.object({
  name: z.string().trim().min(1, "Member name is required"),
});

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

    const parsed = addAdminMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const normalizedName = parsed.data.name.trim();
    const eventMembers = await storage.getMembersByEvent(id);
    const duplicateMember = eventMembers.find((member) => member.name === normalizedName);
    if (duplicateMember) {
      return res.status(409).json({ error: "A member with the same name already exists" });
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

  app.post("/api/events", async (req, res) => {
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { name, keyword, memberNames } = parsed.data;
    const existing = await storage.getEventByKeyword(keyword);
    if (existing) {
      return res.status(409).json({ error: "That keyword is already in use" });
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

  app.post("/api/events/join", async (req, res) => {
    const { keyword } = req.body;
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

  app.get("/api/events/:id/payments", async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const eventPayments = await storage.getPaymentsByEvent(id);
    return res.json(eventPayments);
  });

  app.post("/api/events/:id/payments", async (req, res) => {
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

    const parsed = addPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { payerId, amount, description, splitMemberIds } = parsed.data;
    const eventMembers = await storage.getMembersByEvent(id);
    const memberIds = new Set(eventMembers.map((member) => member.id));

    if (!memberIds.has(payerId)) {
      return res.status(400).json({ error: "Payer does not belong to this event" });
    }
    if (splitMemberIds.some((memberId) => !memberIds.has(memberId))) {
      return res.status(400).json({ error: "Split targets must belong to this event" });
    }

    const payment = await storage.createPayment({
      eventId: id,
      payerId,
      amount,
      description,
      splitMemberIds: JSON.stringify(splitMemberIds),
      createdAt: new Date().toISOString(),
    });

    return res.status(201).json(payment);
  });

  app.delete("/api/events/:id/payments/:paymentId", async (req, res) => {
    const paymentId = parseInt(String(req.params.paymentId), 10);
    if (isNaN(paymentId)) {
      return res.status(400).json({ error: "Invalid payment ID" });
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
