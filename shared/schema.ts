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
  splitMemberIds: text("split_member_ids").notNull(), // JSON array of member IDs (participants)
  // Split mode: how `amount` is divided among the participants in `splitMemberIds`.
  //  - "equal"  : even split (legacy default; remainder handled deterministically)
  //  - "ratio"  : weighted split, weights stored in splitDetails as { memberId: weight }
  //  - "amount" : exact per-member amounts, stored in splitDetails as { memberId: yen }
  splitMode: text("split_mode").notNull().default("equal"),
  splitDetails: text("split_details"), // nullable JSON object keyed by member id; null => equal
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Field length limits (shared between client and server) — guard against DoS
// and keep inputs reasonable.
// ---------------------------------------------------------------------------
export const LIMITS = {
  eventName: 80,
  keyword: 60,
  memberName: 40,
  description: 100,
  maxMembers: 50,
} as const;

export const SPLIT_MODES = ["equal", "ratio", "amount"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

// ---------------------------------------------------------------------------
// Insert schemas / types
// ---------------------------------------------------------------------------
export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export const insertMemberSchema = createInsertSchema(members).omit({ id: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true });

export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Member = typeof members.$inferSelect;
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// ---------------------------------------------------------------------------
// Payment input schema (used by both the API and the client form).
// A discriminated union on `splitMode`. Amounts are integer yen.
// ---------------------------------------------------------------------------
const memberIdList = z
  .array(z.number().int().positive())
  .min(1, "割り勘の対象を1人以上選んでください");

const basePaymentFields = {
  payerId: z.number().int().positive(),
  amount: z
    .number({ invalid_type_error: "金額を入力してください" })
    .int("金額は1円単位で入力してください")
    .positive("金額は1円以上で入力してください")
    .max(100_000_000, "金額が大きすぎます"),
  description: z
    .string()
    .trim()
    .min(1, "内容を入力してください")
    .max(LIMITS.description, `内容は${LIMITS.description}文字以内で入力してください`),
};

// weights / amounts are objects keyed by member id (as string, since JSON object
// keys are strings). Values are positive numbers.
const detailRecord = z.record(z.string(), z.number());

export const paymentInputSchema = z
  .discriminatedUnion("splitMode", [
    z.object({
      ...basePaymentFields,
      splitMode: z.literal("equal"),
      splitMemberIds: memberIdList,
    }),
    z.object({
      ...basePaymentFields,
      splitMode: z.literal("ratio"),
      splitMemberIds: memberIdList,
      weights: detailRecord,
    }),
    z.object({
      ...basePaymentFields,
      splitMode: z.literal("amount"),
      splitMemberIds: memberIdList,
      amounts: detailRecord,
    }),
  ])
  .superRefine((data, ctx) => {
    const ids = new Set(data.splitMemberIds.map(String));

    if (data.splitMode === "ratio") {
      const keys = Object.keys(data.weights);
      if (keys.length !== ids.size || keys.some((key) => !ids.has(key))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "比率の対象者が一致しません" });
        return;
      }
      if (Object.values(data.weights).some((value) => !(value > 0))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "比率は0より大きい値で入力してください" });
      }
    }

    if (data.splitMode === "amount") {
      const keys = Object.keys(data.amounts);
      if (keys.length !== ids.size || keys.some((key) => !ids.has(key))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "金額指定の対象者が一致しません" });
        return;
      }
      const values = Object.values(data.amounts);
      if (values.some((value) => !Number.isInteger(value) || value < 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "内訳は0以上の整数で入力してください" });
        return;
      }
      const sum = values.reduce((acc, value) => acc + value, 0);
      if (sum !== data.amount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `内訳の合計（¥${sum.toLocaleString("ja-JP")}）が金額（¥${data.amount.toLocaleString("ja-JP")}）と一致しません`,
        });
      }
    }
  });

export type PaymentInput = z.infer<typeof paymentInputSchema>;

// Create-event input (shared with the create form).
export const createEventInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "イベント名を入力してください")
    .max(LIMITS.eventName, `イベント名は${LIMITS.eventName}文字以内で入力してください`),
  keyword: z
    .string()
    .trim()
    .min(1, "合言葉を入力してください")
    .max(LIMITS.keyword, `合言葉は${LIMITS.keyword}文字以内で入力してください`),
  memberNames: z
    .array(
      z
        .string()
        .trim()
        .min(1, "メンバー名を入力してください")
        .max(LIMITS.memberName, `メンバー名は${LIMITS.memberName}文字以内で入力してください`),
    )
    .min(2, "メンバーは2人以上必要です")
    .max(LIMITS.maxMembers, `メンバーは${LIMITS.maxMembers}人までです`),
});

export type CreateEventInput = z.infer<typeof createEventInputSchema>;
