import {
  type Admin,
  type InsertAdmin,
  type Event,
  type InsertEvent,
  type Member,
  type InsertMember,
  type Payment,
  type InsertPayment,
  admins,
  events,
  members,
  payments,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const sqlite = new Database(process.env.DB_PATH ?? "data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  // Admin
  getAdmin(id: number): Promise<Admin | undefined>;
  getAdminByUsername(username: string): Promise<Admin | undefined>;
  createAdmin(admin: InsertAdmin): Promise<Admin>;
  ensureDefaultAdmin(): Promise<void>;

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
  deletePayment(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Admin
  async getAdmin(id: number): Promise<Admin | undefined> {
    return db.select().from(admins).where(eq(admins.id, id)).get();
  }

  async getAdminByUsername(username: string): Promise<Admin | undefined> {
    return db.select().from(admins).where(eq(admins.username, username)).get();
  }

  async createAdmin(admin: InsertAdmin): Promise<Admin> {
    return db.insert(admins).values(admin).returning().get();
  }

  async ensureDefaultAdmin(): Promise<void> {
    const existing = db.select().from(admins).get();
    if (!existing) {
      db.insert(admins).values({ username: "admin", password: "admin" }).run();
    }
  }

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
    // Delete associated payments and members first
    db.delete(payments).where(eq(payments.eventId, id)).run();
    db.delete(members).where(eq(members.eventId, id)).run();
    db.delete(events).where(eq(events.id, id)).run();
  }

  async settleEvent(id: number): Promise<Event | undefined> {
    db.update(events).set({ isSettled: true }).where(eq(events.id, id)).run();
    return db.select().from(events).where(eq(events.id, id)).get();
  }

  async updateEventSettlementStatus(id: number, isSettled: boolean): Promise<Event | undefined> {
    db.update(events).set({ isSettled }).where(eq(events.id, id)).run();
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
    db.delete(members).where(eq(members.id, id)).run();
  }

  // Payments
  async createPayment(payment: InsertPayment): Promise<Payment> {
    return db.insert(payments).values(payment).returning().get();
  }

  async getPaymentsByEvent(eventId: number): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.eventId, eventId)).all();
  }

  async deletePayment(id: number): Promise<void> {
    db.delete(payments).where(eq(payments.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
