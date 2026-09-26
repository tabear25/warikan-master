import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Events (trips, gatherings, etc.)
export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    keyword: text("keyword").notNull(),
    // 'trip' のときだけスケジュールタブが有効になる。既存イベントは 'other' のまま。
    type: text("type").notNull().default("other"), // 'trip' | 'meal' | 'other'
    startDate: text("start_date"), // "YYYY-MM-DD"（旅行タイプで任意）
    endDate: text("end_date"),
    createdAt: text("created_at").notNull(),
    isSettled: integer("is_settled", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    // 合言葉は join のルックアップキーかつ一意であるべき値。アプリ層の重複
    // チェックだけではレース条件があるため DB 制約で保証する。
    uniqueIndex("events_keyword_unique").on(table.keyword),
  ],
);

// Members of an event
export const members = sqliteTable(
  "members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id").notNull(),
    name: text("name").notNull(),
    // 受け取り方の希望。null は「未設定」。
    // 口座番号や PayPay ID のような具体値は意図的に持たない — 合言葉を知っている
    // 人は全員この値を読めるため、漏れて困るものを置かない方針にしている。
    // 送る側は手段だけ分かれば、口座や ID は本人に直接聞ける。
    payoutPreference: text("payout_preference"), // PayoutPreference | null
  },
  (table) => [index("members_event_id_idx").on(table.eventId)],
);

// Payment records
export const payments = sqliteTable(
  "payments",
  {
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
    scheduleItemId: integer("schedule_item_id"), // 由来のスケジュール項目（任意・双方向リンク）
    // 先に精算した区切り（partial_settlements.id）。null は未精算。
    // 値が入っている支払いは、区切りを取り消すまで編集・削除できない。
    partialSettlementId: integer("partial_settlement_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("payments_event_id_idx").on(table.eventId)],
);

// 部分精算（例: 旅行前にホテル代と飛行機代だけ先に精算する）の区切り。
// どの支払いを含むかは payments.partialSettlementId が持つ。送金リストは保存せず、
// 含まれる支払いから毎回計算する — 含まれる支払いは編集・削除できないので、
// 計算結果は区切りを作ったときから変わらない。
export const partialSettlements = sqliteTable(
  "partial_settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("partial_settlements_event_id_idx").on(table.eventId)],
);

// Trip schedule items (accommodation / transport / other reservations).
// カテゴリ固有の詳細は metadata（JSON 文字列）に閉じ込め、テーブル追加を避ける。
export const scheduleItems = sqliteTable(
  "schedule_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventId: integer("event_id").notNull(),
    category: text("category").notNull(), // 'accommodation' | 'transport' | 'other'
    title: text("title").notNull(),
    url: text("url"),
    ogpTitle: text("ogp_title"),
    ogpImage: text("ogp_image"),
    ogpDescription: text("ogp_description"),
    startAt: text("start_at"), // "YYYY-MM-DDTHH:mm"（JST ローカル時刻。datetime-local と同形式）
    endAt: text("end_at"),
    address: text("address"),
    memo: text("memo"),
    metadata: text("metadata"), // JSON string（カテゴリ別詳細。scheduleItemInputSchema 参照）
    cost: real("cost"), // 割り勘対象金額（円、任意）
    payerId: integer("payer_id"), // 支払者 members.id（任意）
    paymentId: integer("payment_id"), // payments.id（割り勘に変換済みなら設定）
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("schedule_items_event_id_idx").on(table.eventId)],
);

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
  scheduleTitle: 80,
  url: 2048,
  address: 200,
  memo: 500,
  metaField: 100, // 予約番号・便名・座席など metadata 内の短いテキスト
  maxScheduleItems: 100, // 1 イベントあたりのスケジュール項目上限
} as const;

export const SPLIT_MODES = ["equal", "ratio", "amount"] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

export const EVENT_TYPES = ["trip", "meal", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// メンバーが希望する受け取り方。手段だけを持ち、口座番号や ID は持たない
// （members.payoutPreference のコメント参照）。
export const PAYOUT_PREFERENCES = ["bank", "paypay", "cash", "any"] as const;
export type PayoutPreference = (typeof PAYOUT_PREFERENCES)[number];

export const PAYOUT_PREFERENCE_LABELS: Record<PayoutPreference, string> = {
  bank: "銀行振込",
  paypay: "PayPay",
  cash: "現金で手渡し",
  any: "どれでもいい",
};

export const SCHEDULE_CATEGORIES = ["accommodation", "transport", "other"] as const;
export type ScheduleCategory = (typeof SCHEDULE_CATEGORIES)[number];

export const TRANSPORT_MODES = ["shinkansen", "flight", "train", "bus", "car", "taxi", "other"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const OTHER_KINDS = ["rentalcar", "restaurant", "sightseeing", "ticket", "other"] as const;
export type OtherKind = (typeof OTHER_KINDS)[number];

// ---------------------------------------------------------------------------
// Insert schemas / types
// ---------------------------------------------------------------------------
export const insertEventSchema = createInsertSchema(events).omit({ id: true });
export const insertMemberSchema = createInsertSchema(members).omit({ id: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true });
export const insertPartialSettlementSchema = createInsertSchema(partialSettlements).omit({ id: true });
export const insertScheduleItemSchema = createInsertSchema(scheduleItems).omit({ id: true });

export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Member = typeof members.$inferSelect;
export type InsertMember = z.infer<typeof insertMemberSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type PartialSettlement = typeof partialSettlements.$inferSelect;
export type InsertPartialSettlement = z.infer<typeof insertPartialSettlementSchema>;
export type ScheduleItem = typeof scheduleItems.$inferSelect;
export type InsertScheduleItem = z.infer<typeof insertScheduleItemSchema>;

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
//
// 比率の重みには有限性と上限を課す。`z.number()` は Infinity も 1e308 も通すため、
// 制限しないと splitYen の (total * wi) / weightSum が Infinity になり、
// 余り配分の while ループが停止しなくなる（サーバのイベントループを占有する）。
// 1000 倍を超える比率差は実用上ないので、上限としては十分に緩い。
export const MAX_SPLIT_WEIGHT = 1000;

const weightRecord = z.record(
  z.string(),
  z
    .number({ invalid_type_error: "比率には数値を入力してください" })
    .finite("比率には有限の数値を入力してください")
    .positive("比率は0より大きい値で入力してください")
    .max(MAX_SPLIT_WEIGHT, `比率は${MAX_SPLIT_WEIGHT}以下で入力してください`),
);

// 金額指定の内訳。合計と `amount` の一致は superRefine 側で検証する。
const amountRecord = z.record(
  z.string(),
  z.number({ invalid_type_error: "金額には数値を入力してください" }).finite("金額には有限の数値を入力してください"),
);

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
      weights: weightRecord,
    }),
    z.object({
      ...basePaymentFields,
      splitMode: z.literal("amount"),
      splitMemberIds: memberIdList,
      amounts: amountRecord,
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

// 部分精算の作成（POST /api/events/:id/partial-settlements）。
// 上限は濫用対策の緩い値で、1イベントの支払い件数としては実用上届かない。
export const partialSettlementInputSchema = z.object({
  paymentIds: z
    .array(
      z
        .number({ invalid_type_error: "支払いの指定が不正です" })
        .int("支払いの指定が不正です")
        .positive("支払いの指定が不正です"),
      { required_error: "精算する支払いを選んでください", invalid_type_error: "精算する支払いを選んでください" },
    )
    .min(1, "精算する支払いを1件以上選んでください")
    .max(1000, "一度に精算できる支払いは1000件までです"),
});

export type PartialSettlementInput = z.infer<typeof partialSettlementInputSchema>;

// ---------------------------------------------------------------------------
// Shared field helpers（日付・URL・任意テキスト）
// ---------------------------------------------------------------------------
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/; // <input type="date">
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/; // <input type="datetime-local">

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// 空文字は「未入力」として undefined に正規化する（フォーム入力との整合）。
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}は${max}文字以内で入力してください`)
    .optional()
    .transform((value) => (value ? value : undefined));

const optionalHttpUrl = (label: string) =>
  optionalText(LIMITS.url, label).refine(
    (value) => value === undefined || isHttpUrl(value),
    `${label}は http(s) の URL を入力してください`,
  );

const optionalDate = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine(
      (value) => value === undefined || DATE_PATTERN.test(value),
      `${label}の形式が不正です`,
    );

const optionalDateTime = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .refine(
      (value) => value === undefined || DATETIME_PATTERN.test(value),
      `${label}の形式が不正です`,
    );

// Create-event input (shared with the create form).
export const createEventInputSchema = z
  .object({
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
    // 旧クライアント互換のためすべて任意。type 未指定は 'other' として扱う。
    type: z.enum(EVENT_TYPES).optional(),
    startDate: optionalDate("開始日"),
    endDate: optionalDate("終了日"),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "終了日は開始日以降にしてください" });
    }
  });

export type CreateEventInput = z.infer<typeof createEventInputSchema>;

// イベントのタイプ・期間の変更（PATCH /api/events/:id）。null は「クリア」を意味する。
export const updateEventInputSchema = z
  .object({
    type: z.enum(EVENT_TYPES).optional(),
    startDate: optionalDate("開始日").nullable(),
    endDate: optionalDate("終了日").nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "終了日は開始日以降にしてください" });
    }
  });

export type UpdateEventInput = z.infer<typeof updateEventInputSchema>;

// メンバーの受け取り方の希望の変更（PATCH /api/events/:id/members/:memberId）。
// null は「未設定に戻す」を意味する。
export const updateMemberInputSchema = z.object({
  payoutPreference: z.enum(PAYOUT_PREFERENCES).nullable(),
});

export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;

// ---------------------------------------------------------------------------
// Schedule item input schema（API とクライアントのフォームで共用）。
// category で分岐する discriminated union。metadata はカテゴリ別に検証し、
// 未知のキーは除去して JSON で保存する。
// ---------------------------------------------------------------------------
const accommodationMetadataSchema = z.object({
  reservationNumber: optionalText(LIMITS.metaField, "予約番号"),
  phone: optionalText(LIMITS.metaField, "電話番号"),
});

const transportMetadataSchema = z.object({
  mode: z.enum(TRANSPORT_MODES).default("train"),
  from: optionalText(LIMITS.metaField, "出発地"),
  to: optionalText(LIMITS.metaField, "到着地"),
  trainOrFlightNo: optionalText(LIMITS.metaField, "便名・列車名"),
  seat: optionalText(LIMITS.metaField, "座席"),
  reservationNumber: optionalText(LIMITS.metaField, "予約番号"),
});

const otherMetadataSchema = z.object({
  kind: z.enum(OTHER_KINDS).default("other"),
  reservationNumber: optionalText(LIMITS.metaField, "予約番号"),
});

export type AccommodationMetadata = z.infer<typeof accommodationMetadataSchema>;
export type TransportMetadata = z.infer<typeof transportMetadataSchema>;
export type OtherMetadata = z.infer<typeof otherMetadataSchema>;

const scheduleItemBaseFields = {
  title: z
    .string()
    .trim()
    .min(1, "タイトルを入力してください")
    .max(LIMITS.scheduleTitle, `タイトルは${LIMITS.scheduleTitle}文字以内で入力してください`),
  url: optionalHttpUrl("URL"),
  startAt: optionalDateTime("開始日時"),
  endAt: optionalDateTime("終了日時"),
  address: optionalText(LIMITS.address, "住所"),
  memo: optionalText(LIMITS.memo, "メモ"),
  cost: z
    .number({ invalid_type_error: "金額を入力してください" })
    .int("金額は1円単位で入力してください")
    .positive("金額は1円以上で入力してください")
    .max(100_000_000, "金額が大きすぎます")
    .optional(),
  payerId: z.number().int().positive().optional(),
  // OGP は /api/ogp で取得した結果をクライアントがそのまま送る（表示用キャッシュ）。
  ogpTitle: optionalText(200, "OGPタイトル"),
  ogpImage: optionalHttpUrl("OGP画像"),
  ogpDescription: optionalText(300, "OGP説明"),
};

export const scheduleItemInputSchema = z
  .discriminatedUnion("category", [
    z.object({
      category: z.literal("accommodation"),
      ...scheduleItemBaseFields,
      metadata: accommodationMetadataSchema.optional(),
    }),
    z.object({
      category: z.literal("transport"),
      ...scheduleItemBaseFields,
      metadata: transportMetadataSchema.optional(),
    }),
    z.object({
      category: z.literal("other"),
      ...scheduleItemBaseFields,
      metadata: otherMetadataSchema.optional(),
    }),
  ])
  .superRefine((data, ctx) => {
    if (data.startAt && data.endAt && data.endAt < data.startAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "終了日時は開始日時以降にしてください" });
    }
  });

export type ScheduleItemInput = z.infer<typeof scheduleItemInputSchema>;

// OGP 取得リクエスト（POST /api/ogp）。
export const ogpRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URLを入力してください")
    .max(LIMITS.url, `URLは${LIMITS.url}文字以内で入力してください`)
    .refine(isHttpUrl, "http(s) の URL を入力してください"),
});
