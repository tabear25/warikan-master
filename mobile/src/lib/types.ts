// Domain types for the mobile client.
//
// These mirror the server-side Drizzle row types in `shared/schema.ts`. They are
// intentionally re-declared here as plain interfaces (instead of importing
// `@shared/schema`) so the mobile app stays self-contained and does not pull in
// drizzle-orm / drizzle-zod just to read a few row shapes. Keep in sync with
// `shared/schema.ts` if the API response shapes change.

export interface Event {
  id: number;
  name: string;
  keyword: string;
  createdAt: string;
  isSettled: boolean;
}

export interface Member {
  id: number;
  eventId: number;
  name: string;
}

export type SplitMode = "equal" | "ratio" | "amount";

export interface Payment {
  id: number;
  eventId: number;
  payerId: number;
  amount: number;
  description: string;
  /** JSON array of member IDs (participants). */
  splitMemberIds: string;
  splitMode: SplitMode;
  /** Nullable JSON object keyed by member id; null => equal. */
  splitDetails: string | null;
  createdAt: string;
}

/** An event with its members, as returned by the admin list endpoint. */
export interface AdminEvent extends Event {
  members: Member[];
}

/** Shape of `GET /api/events/:id/settlement`. */
export interface SettlementResult {
  transfers: Array<{ from: string; to: string; amount: number }>;
  balances: Record<number, number>;
}

// Field length limits (kept in sync with shared/schema.ts LIMITS).
export const LIMITS = {
  eventName: 80,
  keyword: 60,
  memberName: 40,
  description: 100,
  maxMembers: 50,
} as const;

export const SPLIT_MODES: readonly SplitMode[] = ["equal", "ratio", "amount"];

export const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  equal: "均等",
  ratio: "比率",
  amount: "金額指定",
};
