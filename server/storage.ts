import {
  type Event,
  type InsertEvent,
  type Member,
  type InsertMember,
  type Payment,
  type InsertPayment,
  type ScheduleItem,
  type InsertScheduleItem,
  events,
  members,
  payments,
  scheduleItems,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, inArray } from "drizzle-orm";

// Treat empty/whitespace-only env vars as unset (a blank value in the Render
// dashboard or `sync: false` should not count as "configured").
const cleanEnv = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

// Connection target:
//  - Production (Render): a Turso/libSQL database via TURSO_DATABASE_URL
//    (e.g. "libsql://<name>.turso.io") + TURSO_AUTH_TOKEN. This persists data
//    across container restarts/redeploys/sleep, which a local SQLite file on
//    Render's free tier does NOT (the filesystem is ephemeral).
//  - Local dev: when the Turso vars are unset, fall back to a local file DB so
//    the app runs without a Turso account.
const tursoUrl = cleanEnv(process.env.TURSO_DATABASE_URL);
const authToken = cleanEnv(process.env.TURSO_AUTH_TOKEN);

// Fail fast in production rather than silently writing to an ephemeral local
// file (which would "work" until the next restart and then lose all data) —
// mirrors the startup fail-fast for admin credentials in server/auth.ts.
if (!tursoUrl && process.env.NODE_ENV === "production") {
  throw new Error(
    "TURSO_DATABASE_URL が未設定です。本番ではデータ永続化のため Turso への接続が必須です。" +
      "Render の Environment タブで TURSO_DATABASE_URL（libsql://...）と TURSO_AUTH_TOKEN を設定してください（deploy/README.md 参照）。",
  );
}

const url = tursoUrl ?? `file:${process.env.DB_PATH ?? "data.db"}`;

// Log the connection target (never the auth token) so the live logs make it
// obvious whether the app is on the persistent Turso DB or a local file.
const safeTarget = url.startsWith("file:")
  ? `ローカルファイル ${url.slice("file:".length)}`
  : url.split("?")[0];
console.log(`[storage] DB connection target: ${safeTarget}`);

const client = createClient({ url, authToken });

export const db = drizzle(client);

// テストから :memory: DB を注入できるようにするための型エイリアス。
export type Database = typeof db;

export interface IStorage {
  // Events
  createEvent(event: InsertEvent): Promise<Event>;
  getEvent(id: number): Promise<Event | undefined>;
  getEventByKeyword(keyword: string): Promise<Event | undefined>;
  getAllEvents(): Promise<Event[]>;
  deleteEvent(id: number): Promise<void>;
  settleEvent(id: number): Promise<Event | undefined>;
  updateEventSettlementStatus(id: number, isSettled: boolean): Promise<Event | undefined>;
  updateEventMeta(
    id: number,
    fields: Partial<Pick<InsertEvent, "type" | "startDate" | "endDate">>,
  ): Promise<Event | undefined>;

  // Members
  createMember(member: InsertMember): Promise<Member>;
  getMembersByEvent(eventId: number): Promise<Member[]>;
  getMembersByEventIds(eventIds: number[]): Promise<Member[]>;
  getMember(id: number): Promise<Member | undefined>;
  deleteMember(id: number): Promise<void>;

  // Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPaymentsByEvent(eventId: number): Promise<Payment[]>;
  getPayment(id: number): Promise<Payment | undefined>;
  updatePayment(id: number, fields: Partial<InsertPayment>): Promise<Payment | undefined>;
  deletePayment(id: number): Promise<void>;
  createPaymentLinkedToScheduleItem(payment: InsertPayment, scheduleItemId: number): Promise<Payment>;

  // Schedule items
  getScheduleItemsByEvent(eventId: number): Promise<ScheduleItem[]>;
  getScheduleItem(id: number): Promise<ScheduleItem | undefined>;
  createScheduleItem(item: InsertScheduleItem): Promise<ScheduleItem>;
  updateScheduleItem(id: number, fields: Partial<InsertScheduleItem>): Promise<ScheduleItem | undefined>;
  deleteScheduleItem(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private readonly db: Database;

  constructor(database: Database = db) {
    this.db = database;
  }

  // Events
  async createEvent(event: InsertEvent): Promise<Event> {
    return this.db.insert(events).values(event).returning().get();
  }

  async getEvent(id: number): Promise<Event | undefined> {
    return this.db.select().from(events).where(eq(events.id, id)).get();
  }

  async getEventByKeyword(keyword: string): Promise<Event | undefined> {
    return this.db.select().from(events).where(eq(events.keyword, keyword)).get();
  }

  async getAllEvents(): Promise<Event[]> {
    return this.db.select().from(events).all();
  }

  async deleteEvent(id: number): Promise<void> {
    // Cascade delete schedule items, payments and members before the event,
    // atomically so a crash mid-delete cannot leave orphaned rows.
    await this.db.transaction(async (tx) => {
      await tx.delete(scheduleItems).where(eq(scheduleItems.eventId, id)).run();
      await tx.delete(payments).where(eq(payments.eventId, id)).run();
      await tx.delete(members).where(eq(members.eventId, id)).run();
      await tx.delete(events).where(eq(events.id, id)).run();
    });
  }

  async settleEvent(id: number): Promise<Event | undefined> {
    await this.db.update(events).set({ isSettled: true }).where(eq(events.id, id)).run();
    return this.db.select().from(events).where(eq(events.id, id)).get();
  }

  async updateEventSettlementStatus(id: number, isSettled: boolean): Promise<Event | undefined> {
    await this.db.update(events).set({ isSettled }).where(eq(events.id, id)).run();
    return this.db.select().from(events).where(eq(events.id, id)).get();
  }

  async updateEventMeta(
    id: number,
    fields: Partial<Pick<InsertEvent, "type" | "startDate" | "endDate">>,
  ): Promise<Event | undefined> {
    await this.db.update(events).set(fields).where(eq(events.id, id)).run();
    return this.db.select().from(events).where(eq(events.id, id)).get();
  }

  // Members
  async createMember(member: InsertMember): Promise<Member> {
    return this.db.insert(members).values(member).returning().get();
  }

  async getMembersByEvent(eventId: number): Promise<Member[]> {
    return this.db.select().from(members).where(eq(members.eventId, eventId)).all();
  }

  async getMembersByEventIds(eventIds: number[]): Promise<Member[]> {
    if (eventIds.length === 0) return [];
    return this.db.select().from(members).where(inArray(members.eventId, eventIds)).all();
  }

  async getMember(id: number): Promise<Member | undefined> {
    return this.db.select().from(members).where(eq(members.id, id)).get();
  }

  async deleteMember(id: number): Promise<void> {
    await this.db.delete(members).where(eq(members.id, id)).run();
  }

  // Payments
  async createPayment(payment: InsertPayment): Promise<Payment> {
    return this.db.insert(payments).values(payment).returning().get();
  }

  async getPaymentsByEvent(eventId: number): Promise<Payment[]> {
    return this.db.select().from(payments).where(eq(payments.eventId, eventId)).all();
  }

  async getPayment(id: number): Promise<Payment | undefined> {
    return this.db.select().from(payments).where(eq(payments.id, id)).get();
  }

  async updatePayment(id: number, fields: Partial<InsertPayment>): Promise<Payment | undefined> {
    await this.db.update(payments).set(fields).where(eq(payments.id, id)).run();
    return this.db.select().from(payments).where(eq(payments.id, id)).get();
  }

  async deletePayment(id: number): Promise<void> {
    // スケジュール項目からの変換リンクを外してから削除する（項目は残り、再変換できる）。
    await this.db.transaction(async (tx) => {
      await tx
        .update(scheduleItems)
        .set({ paymentId: null })
        .where(eq(scheduleItems.paymentId, id))
        .run();
      await tx.delete(payments).where(eq(payments.id, id)).run();
    });
  }

  async createPaymentLinkedToScheduleItem(
    payment: InsertPayment,
    scheduleItemId: number,
  ): Promise<Payment> {
    // 支払いの作成とスケジュール項目への逆リンクを原子的に行う。
    return this.db.transaction(async (tx) => {
      const created = await tx.insert(payments).values(payment).returning().get();
      await tx
        .update(scheduleItems)
        .set({ paymentId: created.id, updatedAt: new Date().toISOString() })
        .where(eq(scheduleItems.id, scheduleItemId))
        .run();
      return created;
    });
  }

  // Schedule items
  async getScheduleItemsByEvent(eventId: number): Promise<ScheduleItem[]> {
    const items = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.eventId, eventId))
      .all();
    // 開始日時のあるものを時系列順に、日時未定のものは作成順で末尾に並べる。
    return items.sort((a, b) => {
      if (a.startAt && b.startAt && a.startAt !== b.startAt) return a.startAt.localeCompare(b.startAt);
      if (a.startAt && !b.startAt) return -1;
      if (!a.startAt && b.startAt) return 1;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  async getScheduleItem(id: number): Promise<ScheduleItem | undefined> {
    return this.db.select().from(scheduleItems).where(eq(scheduleItems.id, id)).get();
  }

  async createScheduleItem(item: InsertScheduleItem): Promise<ScheduleItem> {
    return this.db.insert(scheduleItems).values(item).returning().get();
  }

  async updateScheduleItem(
    id: number,
    fields: Partial<InsertScheduleItem>,
  ): Promise<ScheduleItem | undefined> {
    await this.db.update(scheduleItems).set(fields).where(eq(scheduleItems.id, id)).run();
    return this.db.select().from(scheduleItems).where(eq(scheduleItems.id, id)).get();
  }

  async deleteScheduleItem(id: number): Promise<void> {
    // 変換済み支払い側の由来リンクを外してから削除する（支払い自体は消さない）。
    await this.db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ scheduleItemId: null })
        .where(eq(payments.scheduleItemId, id))
        .run();
      await tx.delete(scheduleItems).where(eq(scheduleItems.id, id)).run();
    });
  }
}

export const storage = new DatabaseStorage();
