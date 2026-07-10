import {
  BedDouble,
  Bus,
  Camera,
  Car,
  CarFront,
  CarTaxiFront,
  Navigation,
  Plane,
  Sparkles,
  Ticket,
  TrainFront,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import type {
  EventType,
  OtherKind,
  ScheduleCategory,
  ScheduleItem,
  TransportMode,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// ラベル・アイコン（イベントタイプ / スケジュールカテゴリ共通の見た目定義）
// ---------------------------------------------------------------------------
export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  trip: "旅行",
  meal: "食事",
  other: "その他",
};

export const EVENT_TYPE_ICON: Record<EventType, LucideIcon> = {
  trip: Plane,
  meal: UtensilsCrossed,
  other: Sparkles,
};

export const CATEGORY_LABEL: Record<ScheduleCategory, string> = {
  accommodation: "宿泊",
  transport: "移動",
  other: "その他",
};

export const TRANSPORT_MODE_LABEL: Record<TransportMode, string> = {
  shinkansen: "新幹線",
  flight: "飛行機",
  train: "電車",
  bus: "バス",
  car: "車",
  taxi: "タクシー",
  other: "その他",
};

export const OTHER_KIND_LABEL: Record<OtherKind, string> = {
  rentalcar: "レンタカー",
  restaurant: "飲食店",
  sightseeing: "観光",
  ticket: "チケット",
  other: "その他",
};

const TRANSPORT_MODE_ICON: Record<TransportMode, LucideIcon> = {
  shinkansen: TrainFront,
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  car: Car,
  taxi: CarTaxiFront,
  other: Navigation,
};

const OTHER_KIND_ICON: Record<OtherKind, LucideIcon> = {
  rentalcar: CarFront,
  restaurant: UtensilsCrossed,
  sightseeing: Camera,
  ticket: Ticket,
  other: Sparkles,
};

// ---------------------------------------------------------------------------
// metadata（DB では JSON 文字列）の安全なパース
// ---------------------------------------------------------------------------
export interface ScheduleItemMetadata {
  mode?: TransportMode;
  from?: string;
  to?: string;
  trainOrFlightNo?: string;
  seat?: string;
  reservationNumber?: string;
  phone?: string;
  kind?: OtherKind;
}

export function parseScheduleMetadata(item: ScheduleItem): ScheduleItemMetadata {
  if (!item.metadata) return {};
  try {
    const parsed = JSON.parse(item.metadata);
    return typeof parsed === "object" && parsed !== null ? (parsed as ScheduleItemMetadata) : {};
  } catch {
    return {};
  }
}

export function scheduleItemIcon(item: ScheduleItem, metadata: ScheduleItemMetadata): LucideIcon {
  if (item.category === "accommodation") return BedDouble;
  if (item.category === "transport") {
    return TRANSPORT_MODE_ICON[metadata.mode ?? "other"] ?? Navigation;
  }
  return OTHER_KIND_ICON[metadata.kind ?? "other"] ?? Sparkles;
}

// カードに出す小バッジのラベル（宿泊 / 新幹線 / 飲食店 など、少し具体的に）。
export function scheduleItemBadgeLabel(item: ScheduleItem, metadata: ScheduleItemMetadata): string {
  if (item.category === "accommodation") return CATEGORY_LABEL.accommodation;
  if (item.category === "transport") {
    return TRANSPORT_MODE_LABEL[metadata.mode ?? "other"] ?? CATEGORY_LABEL.transport;
  }
  return OTHER_KIND_LABEL[metadata.kind ?? "other"] ?? CATEGORY_LABEL.other;
}

// ---------------------------------------------------------------------------
// 日付・時刻ヘルパ（startAt/endAt は "YYYY-MM-DDTHH:mm"、日付は "YYYY-MM-DD"。
// すべて JST ローカル前提の文字列としてそのまま扱う）
// ---------------------------------------------------------------------------
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;

function weekdayOf(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return "";
  return WEEKDAYS_JA[new Date(year, month - 1, day).getDay()];
}

/** "2026-07-12" → "7月12日（日）" */
export function formatDateHeading(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  if (!month || !day) return dateKey;
  return `${month}月${day}日（${weekdayOf(dateKey)}）`;
}

/** "2026-07-12" → "7/12（日）" */
export function formatShortDate(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  if (!month || !day) return dateKey;
  return `${month}/${day}（${weekdayOf(dateKey)}）`;
}

export function dateKeyOf(value: string | null): string | null {
  if (!value || value.length < 10) return null;
  return value.slice(0, 10);
}

export function formatTime(value: string | null): string | null {
  if (!value || value.length < 16) return null;
  return value.slice(11, 16);
}

/** "15:00" / "15:00 → 10:00"、日をまたぐ場合は "15:00 → 7/13 10:00" */
export function timeRangeLabel(item: ScheduleItem): string | null {
  const startTime = formatTime(item.startAt);
  if (!startTime) return null;
  const endTime = formatTime(item.endAt);
  if (!endTime) return startTime;
  const startKey = dateKeyOf(item.startAt);
  const endKey = dateKeyOf(item.endAt);
  if (endKey && startKey !== endKey) {
    const [, month, day] = endKey.split("-").map(Number);
    return `${startTime} → ${month}/${day} ${endTime}`;
  }
  return `${startTime} → ${endTime}`;
}

// ---------------------------------------------------------------------------
// 日付グルーピング（サーバは startAt 昇順・未定は末尾で返す前提）
// ---------------------------------------------------------------------------
export interface ScheduleDayGroup {
  dateKey: string | null; // null = 日付未定
  items: ScheduleItem[];
}

export function groupScheduleByDay(items: ScheduleItem[]): ScheduleDayGroup[] {
  const dated = new Map<string, ScheduleItem[]>();
  const undated: ScheduleItem[] = [];
  for (const item of items) {
    const key = dateKeyOf(item.startAt);
    if (key === null) {
      undated.push(item);
    } else {
      const bucket = dated.get(key);
      if (bucket) bucket.push(item);
      else dated.set(key, [item]);
    }
  }
  const groups: ScheduleDayGroup[] = Array.from(dated.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, groupItems]) => ({ dateKey, items: groupItems }));
  if (undated.length > 0) groups.push({ dateKey: null, items: undated });
  return groups;
}

/**
 * 旅行開始日からの日数（DAY 01 表示用）。
 * 開始日が未設定なら日付グループの順番、開始日より前の日付なら 0（= DAY 表示なし）。
 */
export function dayNumberOf(
  dateKey: string,
  eventStartDate: string | null,
  fallbackIndex: number,
): number {
  if (eventStartDate) {
    const start = new Date(`${eventStartDate}T00:00`);
    const current = new Date(`${dateKey}T00:00`);
    if (!isNaN(start.getTime()) && !isNaN(current.getTime())) {
      const diffDays = Math.round((current.getTime() - start.getTime()) / 86_400_000);
      return diffDays >= 0 ? diffDays + 1 : 0;
    }
  }
  return fallbackIndex + 1;
}

export function googleMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// ---------------------------------------------------------------------------
// Googleカレンダー連携（予定作成ページへのリンク）
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" + "HH:mm" → Googleカレンダー用 "YYYYMMDDTHHmm00" */
function toGoogleCalendarDateTime(dateKey: string, time: string): string {
  return `${dateKey.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

/**
 * Googleカレンダーの予定作成ページ URL（action=TEMPLATE）を組み立てる。
 * 開始日時が未定の予定は日時を渡せないため null を返す。
 */
export function googleCalendarUrl(item: ScheduleItem, metadata: ScheduleItemMetadata): string | null {
  const startDate = dateKeyOf(item.startAt);
  const startTime = formatTime(item.startAt);
  if (!startDate || !startTime) return null;

  const endDate = dateKeyOf(item.endAt) ?? startDate;
  const endTime = formatTime(item.endAt);
  let end: string;
  if (endTime) {
    end = toGoogleCalendarDateTime(endDate, endTime);
  } else {
    // 終了未定は 1 時間後を仮置き（Googleカレンダー側で変更できる）
    const dt = new Date(`${startDate}T${startTime}`);
    dt.setHours(dt.getHours() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    end = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
  }

  const detailLines: string[] = [];
  if (item.category === "transport" && (metadata.from || metadata.to)) {
    detailLines.push(`${metadata.from ?? "？"} → ${metadata.to ?? "？"}`);
  }
  if (metadata.trainOrFlightNo) detailLines.push(`便名・列車名: ${metadata.trainOrFlightNo}`);
  if (metadata.seat) detailLines.push(`座席: ${metadata.seat}`);
  if (metadata.reservationNumber) detailLines.push(`予約番号: ${metadata.reservationNumber}`);
  if (metadata.phone) detailLines.push(`電話番号: ${metadata.phone}`);
  if (item.url) detailLines.push(item.url);
  if (item.memo) detailLines.push(item.memo);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: `${toGoogleCalendarDateTime(startDate, startTime)}/${end}`,
    // startAt/endAt は JST ローカル前提の文字列なので、閲覧者のカレンダー設定に
    // 依存しないようタイムゾーンを明示する
    ctz: "Asia/Tokyo",
  });
  if (detailLines.length > 0) params.set("details", detailLines.join("\n"));
  if (item.address) params.set("location", item.address);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
