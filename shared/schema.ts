import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Events (trips, gatherings, etc.)
export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  keyword: text("keyword").notNull(),
  createdAt: text("created_at").notNull(),
  isSettled: integer("is_settled", { mode: "boolean" }).notNull().default(false),
});

// Members of an event
export const members = sqliteTable("members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
});

// Payment records
export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventId: integer("event_id").notNull(),
  payerId: integer("payer_id").notNull(),
  amount: real("amount").notNull(),
  description: text("description").notNull(),
  splitMemberIds: text("split_member_ids").notNull(), // JSON array of member IDs
  createdAt: text("created_at").notNull(),
});

// Export schemas and types
export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export const insertMemberSchema = createInsertSchema(members).omit({ id: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true });

export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Member = typeof members.$inferSelect;
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
