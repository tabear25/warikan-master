import {
  type Event,
  type InsertEvent,
  type Member,
  type InsertMember,
  type Payment,
  type InsertPayment,
  events,
  members,
  payments,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

// Connection target:
//  - Production (Render): a Turso/libSQL database via TURSO_DATABASE_URL
//    (e.g. "libsql://<name>.turso.io") + TURSO_AUTH_TOKEN. This persists data
//    across container restarts/redeploys/sleep, which a local SQLite file on
//    Render's free tier does NOT (the filesystem is ephemeral).
//  - Local dev: when the Turso vars are unset, fall back to a local file DB so
//    the app runs without a Turso account.
const url =
  process.env.TURSO_DATABASE_URL ?? `file:${process.env.DB_PATH ?? "data.db"}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient({ url, authToken });

export const db = drizzle(client);

export interface IStorage {
  // Events
  createEvent(event: InsertEvent): Promise<Event>;
  getEvent(id: number): Promise<Event | undefined>;
  getEventByKeyword(keyword: string): Promise<Event | undefined>;
  getAllEvents(): Promise<Event[]>;
  deleteEvent(id: number): Promise<void>;
  settleEvent(id: number): Promise<Event | undefined>;
  updateEventSettlementStatus(id: number, isSettled: boolean): Promise<Event | undefined>;

  // Members
  createMember(member: InsertMember): Promise<Member>;
  getMembersByEvent(eventId: number): Promise<Member[]>;
  getMember(id: number): Promise<Member | undefined>;
  deleteMember(id: number): Promise<void>;

  // Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPaymentsByEvent(eventId: number): Promise<Payment[]>;
  getPayment(id: number): Promise<Payment | undefined>;
  updatePayment(id: number, fields: Partial<InsertPayment>): Promise<Payment | undefined>;
  deletePayment(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Events
  async createEvent(event: InsertEvent): Promise<Event> {
    return db.insert(events).values(event).returning().get();
  }

  async getEvent(id: number): Promise<Event | undefined> {
    return db.select().from(events).where(eq(events.id, id)).get();
  }

  async getEventByKeyword(keyword: string): Promise<Event | undefined> {
    return db.select().from(events).where(eq(events.keyword, keyword)).get();
  }

  async getAllEvents(): Promise<Event[]> {
    return db.select().from(events).all();
  }

  async deleteEvent(id: number): Promise<void> {
    // Cascade delete payments and members before the event, atomically so a
    // crash mid-delete cannot leave orphaned rows.
    await db.transaction(async (tx) => {
      await tx.delete(payments).where(eq(payments.eventId, id)).run();
      await tx.delete(members).where(eq(members.eventId, id)).run();
      await tx.delete(events).where(eq(events.id, id)).run();
    });
  }

  async settleEvent(id: number): Promise<Event | undefined> {
    await db.update(events).set({ isSettled: true }).where(eq(events.id, id)).run();
    return db.select().from(events).where(eq(events.id, id)).get();
  }

  async updateEventSettlementStatus(id: number, isSettled: boolean): Promise<Event | undefined> {
    await db.update(events).set({ isSettled }).where(eq(events.id, id)).run();
    return db.select().from(events).where(eq(events.id, id)).get();
  }

  // Members
  async createMember(member: InsertMember): Promise<Member> {
    return db.insert(members).values(member).returning().get();
  }

  async getMembersByEvent(eventId: number): Promise<Member[]> {
    return db.select().from(members).where(eq(members.eventId, eventId)).all();
  }

  async getMember(id: number): Promise<Member | undefined> {
    return db.select().from(members).where(eq(members.id, id)).get();
  }

  async deleteMember(id: number): Promise<void> {
    await db.delete(members).where(eq(members.id, id)).run();
  }

  // Payments
  async createPayment(payment: InsertPayment): Promise<Payment> {
    return db.insert(payments).values(payment).returning().get();
  }

  async getPaymentsByEvent(eventId: number): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.eventId, eventId)).all();
  }

  async getPayment(id: number): Promise<Payment | undefined> {
    return db.select().from(payments).where(eq(payments.id, id)).get();
  }

  async updatePayment(id: number, fields: Partial<InsertPayment>): Promise<Payment | undefined> {
    await db.update(payments).set(fields).where(eq(payments.id, id)).run();
    return db.select().from(payments).where(eq(payments.id, id)).get();
  }

  async deletePayment(id: number): Promise<void> {
    await db.delete(payments).where(eq(payments.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
