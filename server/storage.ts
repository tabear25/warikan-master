import {
  type Event,
  type InsertEvent,
  type Member,
  type InsertMember,
  type Payment,
  type InsertPayment,
  type PartialSettlement,
  type InsertPartialSettlement,
  type ScheduleItem,
  type InsertScheduleItem,
  events,
  members,
  payments,
  partialSettlements,
  scheduleItems,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

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

// 部分精算に含めようとした支払いの一部が、すでに別の区切りに含まれていた
// （同時に2人が操作した場合など）。ルートは 409 を返す。
export class PartialSettlementConflictError extends Error {
  constructor() {
    super("すでに先に精算した支払いが含まれています");
    this.name = "PartialSettlementConflictError";
  }
}

// 先に精算した支払いを書き換えようとした。ルートの事前チェックと書き込みの間に
// 部分精算がコミットされた場合も、書き込み側の条件で止めてこのエラーにする。
// ルートは 400 を返す。
export class PaymentSettledEarlyError extends Error {
  constructor() {
    super("先に精算した支払いは変更できません");
    this.name = "PaymentSettledEarlyError";
  }
}

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
  updateMember(
    id: number,
    fields: Partial<Pick<InsertMember, "payoutPreference">>,
  ): Promise<Member | undefined>;
  deleteMember(id: number): Promise<void>;

  // Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPaymentsByEvent(eventId: number): Promise<Payment[]>;
  getPayment(id: number): Promise<Payment | undefined>;
  updatePayment(id: number, fields: Partial<InsertPayment>): Promise<Payment | undefined>;
  deletePayment(id: number): Promise<void>;
  createPaymentLinkedToScheduleItem(payment: InsertPayment, scheduleItemId: number): Promise<Payment>;

  // Partial settlements（先に一部の支払いだけ精算した区切り）
  getPartialSettlementsByEvent(eventId: number): Promise<PartialSettlement[]>;
  getPartialSettlement(id: number): Promise<PartialSettlement | undefined>;
  createPartialSettlement(
    partial: InsertPartialSettlement,
    paymentIds: number[],
  ): Promise<{ partial: PartialSettlement; payments: Payment[] }>;
  deletePartialSettlement(id: number, eventId: number): Promise<void>;

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
    // Cascade delete schedule items, payments, partial settlements and members
    // before the event, atomically so a crash mid-delete cannot leave orphaned rows.
    await this.db.transaction(async (tx) => {
      await tx.delete(scheduleItems).where(eq(scheduleItems.eventId, id)).run();
      await tx.delete(payments).where(eq(payments.eventId, id)).run();
      await tx.delete(partialSettlements).where(eq(partialSettlements.eventId, id)).run();
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

  async updateMember(
    id: number,
    fields: Partial<Pick<InsertMember, "payoutPreference">>,
  ): Promise<Member | undefined> {
    await this.db.update(members).set(fields).where(eq(members.id, id)).run();
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
    // ID 順を保証する（部分精算の paymentIds の並びを、作成時の応答と揃えるため）。
    return this.db
      .select()
      .from(payments)
      .where(eq(payments.eventId, eventId))
      .orderBy(asc(payments.id))
      .all();
  }

  async getPayment(id: number): Promise<Payment | undefined> {
    return this.db.select().from(payments).where(eq(payments.id, id)).get();
  }

  async updatePayment(id: number, fields: Partial<InsertPayment>): Promise<Payment | undefined> {
    // 先に精算した支払いは書き換えない（その区切りの送金額が黙って変わるため）。
    // 条件を書き込み自体に入れて、ルートの事前チェックとの間の競合も止める。
    const result = await this.db
      .update(payments)
      .set(fields)
      .where(and(eq(payments.id, id), isNull(payments.partialSettlementId)))
      .run();
    const current = await this.db.select().from(payments).where(eq(payments.id, id)).get();
    if (result.rowsAffected === 0 && current?.partialSettlementId != null) {
      throw new PaymentSettledEarlyError();
    }
    return current;
  }

  async deletePayment(id: number): Promise<void> {
    // 支払いを消し、スケジュール項目からの変換リンクを外す（項目は残り、再変換できる）。
    // 先に精算した支払いは消さない（updatePayment と同じく書き込みの条件で止める）。
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(payments)
        .where(and(eq(payments.id, id), isNull(payments.partialSettlementId)))
        .run();
      if (deleted.rowsAffected === 0) {
        const current = await tx.select().from(payments).where(eq(payments.id, id)).get();
        if (current?.partialSettlementId != null) {
          throw new PaymentSettledEarlyError();
        }
        return;
      }
      await tx
        .update(scheduleItems)
        .set({ paymentId: null })
        .where(eq(scheduleItems.paymentId, id))
        .run();
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

  // Partial settlements
  async getPartialSettlementsByEvent(eventId: number): Promise<PartialSettlement[]> {
    return this.db
      .select()
      .from(partialSettlements)
      .where(eq(partialSettlements.eventId, eventId))
      .orderBy(asc(partialSettlements.id))
      .all();
  }

  async getPartialSettlement(id: number): Promise<PartialSettlement | undefined> {
    return this.db.select().from(partialSettlements).where(eq(partialSettlements.id, id)).get();
  }

  async createPartialSettlement(
    partial: InsertPartialSettlement,
    paymentIds: number[],
  ): Promise<{ partial: PartialSettlement; payments: Payment[] }> {
    // 区切りの作成と支払いへの紐付けを原子的に行う。紐付けるのは「このイベントの、
    // まだどの区切りにも含まれていない支払い」だけで、件数が合わなければ全体を巻き戻す。
    // ルート側の事前チェックとの間に別の部分精算が同じ支払いを取った場合も、ここで止まる。
    // paymentIds は重複を除いてから渡すこと（件数の比較に使うため）。
    return this.db.transaction(async (tx) => {
      const created = await tx.insert(partialSettlements).values(partial).returning().get();
      const result = await tx
        .update(payments)
        .set({ partialSettlementId: created.id })
        .where(
          and(
            eq(payments.eventId, partial.eventId),
            inArray(payments.id, paymentIds),
            isNull(payments.partialSettlementId),
          ),
        )
        .run();
      if (result.rowsAffected !== paymentIds.length) {
        throw new PartialSettlementConflictError();
      }
      // 実際に区切りに入った内容を返す（事前チェックのあとに編集された場合も、
      // 保存された金額で応答を組み立てられるように）。
      const included = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.eventId, partial.eventId), eq(payments.partialSettlementId, created.id)))
        .orderBy(asc(payments.id))
        .all();
      return { partial: created, payments: included };
    });
  }

  async deletePartialSettlement(id: number, eventId: number): Promise<void> {
    // 含まれていた支払いを未精算に戻してから区切りを消す（支払い自体は消さない）。
    // eventId を条件に入れるのは payments_event_id_idx を効かせるため。
    await this.db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ partialSettlementId: null })
        .where(and(eq(payments.eventId, eventId), eq(payments.partialSettlementId, id)))
        .run();
      await tx.delete(partialSettlements).where(eq(partialSettlements.id, id)).run();
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
