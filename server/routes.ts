import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { z } from "zod";

// Settlement calculation types
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
  paymentList: Array<{ payerId: number; amount: number; splitMemberIds: string }>
): SettlementResult {
  // Calculate net balance for each member
  const balances: Record<number, number> = {};
  memberList.forEach((m) => (balances[m.id] = 0));

  for (const payment of paymentList) {
    const splitIds: number[] = JSON.parse(payment.splitMemberIds);
    const share = payment.amount / splitIds.length;

    // Payer gets credited the full amount
    balances[payment.payerId] = (balances[payment.payerId] ?? 0) + payment.amount;

    // Each person in split owes their share
    for (const memberId of splitIds) {
      balances[memberId] = (balances[memberId] ?? 0) - share;
    }
  }

  // Greedy algorithm: match debtors with creditors
  const debtors = memberList
    .filter((m) => balances[m.id] < -0.01)
    .map((m) => ({ id: m.id, name: m.name, amount: -balances[m.id] }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = memberList
    .filter((m) => balances[m.id] > 0.01)
    .map((m) => ({ id: m.id, name: m.name, amount: balances[m.id] }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
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

    if (debtor.amount < 0.01) i++;
    if (creditor.amount < 0.01) j++;
  }

  return { transfers, balances };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Ensure default admin exists on startup
  await storage.ensureDefaultAdmin();

  // ── Admin Auth ──────────────────────────────────────────────────────────────

  const adminLoginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  app.post("/api/admin/login", async (req, res) => {
    const parsed = adminLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "入力が無効です" });
    }
    const { username, password } = parsed.data;
    const admin = await storage.getAdminByUsername(username);
    if (!admin || admin.password !== password) {
      return res.status(401).json({ success: false, error: "ユーザー名またはパスワードが違います" });
    }
    return res.json({ success: true, admin: { id: admin.id, username: admin.username } });
  });

  // ── Admin Events ────────────────────────────────────────────────────────────

  // Simple header-based admin check
  const requireAdmin = async (req: any, res: any, next: any) => {
    const adminUsername = req.headers["x-admin-username"];
    const adminPassword = req.headers["x-admin-password"];
    if (!adminUsername || !adminPassword) {
      return res.status(401).json({ error: "管理者権限が必要です" });
    }
    const admin = await storage.getAdminByUsername(adminUsername as string);
    if (!admin || admin.password !== adminPassword) {
      return res.status(401).json({ error: "認証に失敗しました" });
    }
    next();
  };

  app.get("/api/admin/events", requireAdmin, async (_req, res) => {
    const allEvents = await storage.getAllEvents();
    return res.json(allEvents);
  });

  app.delete("/api/admin/events/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "無効なIDです" });
    await storage.deleteEvent(id);
    return res.json({ success: true });
  });

  // ── Events ──────────────────────────────────────────────────────────────────

  const createEventSchema = z.object({
    name: z.string().min(1, "イベント名を入力してください"),
    keyword: z.string().min(1, "合言葉を入力してください"),
    memberNames: z.array(z.string().min(1)).min(2, "メンバーは2人以上必要です"),
  });

  app.post("/api/events", async (req, res) => {
    const parsed = createEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { name, keyword, memberNames } = parsed.data;

    // Check keyword uniqueness
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
      memberNames.map((n) => storage.createMember({ eventId: event.id, name: n }))
    );

    return res.status(201).json({ event, members: createdMembers });
  });

  app.post("/api/events/join", async (req, res) => {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: "合言葉を入力してください" });

    const event = await storage.getEventByKeyword(keyword);
    if (!event) return res.status(404).json({ error: "イベントが見つかりません" });

    const eventMembers = await storage.getMembersByEvent(event.id);
    return res.json({ event, members: eventMembers });
  });

  app.get("/api/events/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "無効なIDです" });
    const event = await storage.getEvent(id);
    if (!event) return res.status(404).json({ error: "イベントが見つかりません" });
    return res.json(event);
  });

  app.get("/api/events/:id/members", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "無効なIDです" });
    const eventMembers = await storage.getMembersByEvent(id);
    return res.json(eventMembers);
  });

  app.get("/api/events/:id/payments", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "無効なIDです" });
    const eventPayments = await storage.getPaymentsByEvent(id);
    return res.json(eventPayments);
  });

  const addPaymentSchema = z.object({
    payerId: z.number().int().positive(),
    amount: z.number().positive("金額を入力してください"),
    description: z.string().min(1, "説明を入力してください"),
    splitMemberIds: z.array(z.number().int().positive()).min(1),
  });

  app.post("/api/events/:id/payments", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "無効なIDです" });

    const event = await storage.getEvent(id);
    if (!event) return res.status(404).json({ error: "イベントが見つかりません" });
    if (event.isSettled) return res.status(400).json({ error: "精算済みのイベントです" });

    const parsed = addPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const { payerId, amount, description, splitMemberIds } = parsed.data;

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
    const paymentId = parseInt(req.params.paymentId);
    if (isNaN(paymentId)) return res.status(400).json({ error: "無効なIDです" });
    await storage.deletePayment(paymentId);
    return res.json({ success: true });
  });

  app.get("/api/events/:id/settlement", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "無効なIDです" });

    const event = await storage.getEvent(id);
    if (!event) return res.status(404).json({ error: "イベントが見つかりません" });

    const eventMembers = await storage.getMembersByEvent(id);
    const eventPayments = await storage.getPaymentsByEvent(id);

    const result = calculateSettlement(eventMembers, eventPayments);
    return res.json(result);
  });

  app.post("/api/events/:id/settle", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "無効なIDです" });

    const event = await storage.settleEvent(id);
    if (!event) return res.status(404).json({ error: "イベントが見つかりません" });
    return res.json(event);
  });

  return httpServer;
}
