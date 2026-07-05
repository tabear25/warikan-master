import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MemberAvatar } from "@/components/member-avatar";
import { ScheduleItemDialog } from "@/components/schedule-item-dialog";
import { cn } from "@/lib/utils";
import { formatYen } from "@/lib/currency";
import {
  dayNumberOf,
  formatDateHeading,
  googleMapsUrl,
  groupScheduleByDay,
  parseScheduleMetadata,
  scheduleItemBadgeLabel,
  scheduleItemIcon,
  timeRangeLabel,
} from "@/lib/schedule";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  MapPin,
  Pencil,
  PlusCircle,
  Trash2,
} from "lucide-react";
import type { Event, Member, ScheduleItem } from "@shared/schema";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// タイムラインの 1 行（レール + カード）。タップで詳細を展開する。
// ---------------------------------------------------------------------------
interface ScheduleItemRowProps {
  item: ScheduleItem;
  members: Member[];
  isSettled: boolean;
  isLast: boolean;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onConvert: () => void;
  onShowPayments: () => void;
}

function ScheduleItemRow({
  item,
  members,
  isSettled,
  isLast,
  index,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onConvert,
  onShowPayments,
}: ScheduleItemRowProps) {
  const metadata = parseScheduleMetadata(item);
  const Icon = scheduleItemIcon(item, metadata);
  const time = timeRangeLabel(item);
  const badgeLabel = scheduleItemBadgeLabel(item, metadata);
  const payerName = item.payerId != null ? members.find((m) => m.id === item.payerId)?.name : undefined;
  const converted = item.paymentId != null;

  // 折りたたみ時のサブ情報（最重要のものだけ）：移動は 出発 → 到着、それ以外は住所。
  let subline: string | null = null;
  if (item.category === "transport") {
    if (metadata.from || metadata.to) {
      subline = `${metadata.from ?? "？"} → ${metadata.to ?? "？"}`;
    }
  } else if (item.address) {
    subline = item.address;
  }

  // 展開時の詳細行
  const detailRows: Array<{ label: string; value: React.ReactNode }> = [];
  if (item.category === "transport") {
    if (metadata.trainOrFlightNo) detailRows.push({ label: "便名・列車名", value: metadata.trainOrFlightNo });
    if (metadata.seat) detailRows.push({ label: "座席", value: metadata.seat });
  }
  if (metadata.reservationNumber) detailRows.push({ label: "予約番号", value: metadata.reservationNumber });
  if (item.category === "accommodation" && metadata.phone) {
    detailRows.push({
      label: "電話番号",
      value: (
        <a href={`tel:${metadata.phone}`} className="text-primary underline-offset-2 hover:underline">
          {metadata.phone}
        </a>
      ),
    });
  }

  return (
    <motion.div
      {...fadeUp}
      transition={{ duration: 0.4, ease: EASE, delay: Math.min(index, 8) * 0.04 }}
      className="flex gap-3 pb-3"
    >
      {/* タイムラインのレール */}
      <div className="flex w-9 shrink-0 flex-col items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          <Icon className="h-4 w-4" />
        </div>
        {!isLast && <div className="mt-1.5 w-px flex-1 rounded-full bg-border" />}
      </div>

      {/* カード */}
      <Card className={cn("min-w-0 flex-1 transition-shadow duration-200", expanded && "shadow-md")} data-testid={`schedule-item-${item.id}`}>
        <button
          type="button"
          className="w-full text-left"
          onClick={onToggle}
          aria-expanded={expanded}
          data-testid={`button-toggle-schedule-${item.id}`}
        >
          <CardContent className="p-3.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {time && (
                    <span className="font-display text-xs font-semibold tabular-nums text-primary">{time}</span>
                  )}
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{badgeLabel}</Badge>
                </div>
                <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{item.title}</p>
                {subline && <p className="truncate text-xs text-muted-foreground">{subline}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {item.cost != null && (
                  <span className="money flex items-center gap-1 text-sm font-bold tabular-nums text-foreground">
                    {converted && <CheckCircle2 className="h-3.5 w-3.5 text-positive" aria-label="割り勘に追加済み" />}
                    {formatYen(item.cost)}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    expanded && "rotate-180",
                  )}
                />
              </div>
            </div>
          </CardContent>
        </button>

        {expanded && (
          <CardContent className="space-y-3 border-t border-border/60 p-3.5 pt-3">
            {/* OGP プレビュー */}
            {item.ogpImage && (
              <img
                src={item.ogpImage}
                alt=""
                loading="lazy"
                className="h-28 w-full rounded-xl object-cover"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            )}
            {(item.ogpDescription || item.ogpTitle) && (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {item.ogpDescription ?? item.ogpTitle}
              </p>
            )}

            {/* 詳細情報 */}
            {detailRows.length > 0 && (
              <dl className="space-y-1">
                {detailRows.map((row) => (
                  <div key={row.label} className="flex items-baseline gap-2 text-xs">
                    <dt className="w-20 shrink-0 text-muted-foreground">{row.label}</dt>
                    <dd className="min-w-0 flex-1 break-words font-medium text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {item.memo && (
              <p className="whitespace-pre-wrap rounded-xl bg-muted/60 p-2.5 text-xs text-foreground">{item.memo}</p>
            )}

            {/* アクション */}
            <div className="flex items-start justify-between gap-1.5">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-xs")}
                    data-testid={`link-schedule-url-${item.id}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    ページを開く
                  </a>
                )}
                {item.address && (
                  <a
                    href={googleMapsUrl(item.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-xs")}
                    data-testid={`link-schedule-map-${item.id}`}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    地図
                  </a>
                )}
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
                  onClick={onEdit}
                  data-testid={`button-edit-schedule-${item.id}`}
                  aria-label="予定を編集"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                  onClick={onDelete}
                  data-testid={`button-delete-schedule-${item.id}`}
                  aria-label="予定を削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* 割り勘連携 */}
            {item.cost != null && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-accent/50 p-2.5">
                {payerName ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MemberAvatar name={payerName} className="h-6 w-6 text-[10px]" />
                    <span className="truncate text-xs font-medium text-foreground">{payerName}</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">支払者未定</span>
                )}
                <span className="money ml-auto text-sm font-bold tabular-nums text-foreground">
                  {formatYen(item.cost)}
                </span>
                {converted ? (
                  <button
                    type="button"
                    onClick={onShowPayments}
                    className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2.5 py-1 text-xs font-semibold text-positive transition-colors duration-200 hover:bg-positive/20"
                    data-testid={`button-view-payment-${item.id}`}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    追加済み
                  </button>
                ) : !isSettled ? (
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={onConvert}
                    data-testid={`button-convert-schedule-${item.id}`}
                  >
                    割り勘に追加
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// スケジュールタブ本体（日付グルーピングのタイムライン）
// ---------------------------------------------------------------------------
interface ScheduleTabProps {
  eventId: number;
  event: Event;
  members: Member[];
  onConvert: (item: ScheduleItem) => void;
  onShowPayments: () => void;
}

export function ScheduleTab({ eventId, event, members, onConvert, onShowPayments }: ScheduleTabProps) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ScheduleItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<ScheduleItem | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const scheduleQuery = useQuery<ScheduleItem[]>({
    queryKey: ["/api/events", eventId, "schedule"],
    queryFn: async () => (await apiRequest("GET", `/api/events/${eventId}/schedule`)).json(),
    enabled: !isNaN(eventId) && eventId > 0,
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: number) => {
      await apiRequest("DELETE", `/api/events/${eventId}/schedule/${itemId}`);
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "schedule"] });
      // 変換済み支払いの由来リンク表示も更新する
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "payments"] });
      toast({ title: "予定を削除しました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  const items = scheduleQuery.data ?? [];
  const groups = useMemo(() => groupScheduleByDay(items), [items]);
  const totalCost = useMemo(
    () => items.reduce((acc, item) => acc + (item.cost != null ? Math.round(item.cost) : 0), 0),
    [items],
  );

  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <motion.div {...fadeUp} transition={{ duration: 0.4, ease: EASE }}>
        <Button
          size="lg"
          className="mb-4 w-full"
          onClick={() => { setEditingItem(null); setDialogOpen(true); }}
          data-testid="button-add-schedule"
        >
          <PlusCircle className="h-4 w-4" />
          予定を追加
        </Button>
      </motion.div>

      {/* Summary row */}
      {items.length > 0 && (
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>予定 {items.length} 件</span>
          {totalCost > 0 && (
            <span>
              費用メモ合計{" "}
              <span className="money font-bold text-foreground tabular-nums">{formatYen(totalCost)}</span>
            </span>
          )}
        </div>
      )}

      {scheduleQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <Skeleton className="h-20 flex-1 rounded-2xl" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <motion.div {...fadeUp} transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}>
          <Card>
            <CardContent className="py-12 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
                <CalendarDays className="h-7 w-7" />
              </div>
              <p className="mb-1 text-sm font-semibold text-foreground">まだ予定がありません</p>
              <p className="text-xs text-muted-foreground">
                宿泊や移動の予定を追加して、旅のしおりを作りましょう
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div>
          {groups.map((group, groupIndex) => {
            const dayNumber = group.dateKey ? dayNumberOf(group.dateKey, event.startDate, groupIndex) : 0;
            return (
              <section key={group.dateKey ?? "undated"} className="mb-4">
                <div className="mb-2.5 flex items-baseline gap-2">
                  {group.dateKey ? (
                    <>
                      {dayNumber > 0 && (
                        <span className="font-display text-[11px] font-bold uppercase tracking-[0.25em] text-primary">
                          Day {String(dayNumber).padStart(2, "0")}
                        </span>
                      )}
                      <h3 className="text-sm font-bold text-foreground">{formatDateHeading(group.dateKey)}</h3>
                    </>
                  ) : (
                    <>
                      <span className="font-display text-[11px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                        TBD
                      </span>
                      <h3 className="text-sm font-bold text-foreground">日付未定</h3>
                    </>
                  )}
                </div>
                <div>
                  {group.items.map((item, index) => (
                    <ScheduleItemRow
                      key={item.id}
                      item={item}
                      members={members}
                      isSettled={event.isSettled}
                      isLast={index === group.items.length - 1}
                      index={index}
                      expanded={expandedIds.has(item.id)}
                      onToggle={() => toggleExpanded(item.id)}
                      onEdit={() => { setEditingItem(item); setDialogOpen(true); }}
                      onDelete={() => setItemToDelete(item)}
                      onConvert={() => onConvert(item)}
                      onShowPayments={onShowPayments}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ScheduleItemDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingItem(null); }}
        eventId={eventId}
        members={members}
        item={editingItem}
      />

      <AlertDialog
        open={itemToDelete !== null}
        onOpenChange={(open) => { if (!open) setItemToDelete(null); }}
      >
        {itemToDelete && (
          <AlertDialogContent data-testid="dialog-delete-schedule">
            <AlertDialogHeader>
              <AlertDialogTitle>この予定を削除しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                「{itemToDelete.title}」を削除します。
                {itemToDelete.paymentId != null && "割り勘に追加済みの支払いは削除されず、そのまま残ります。"}
                この操作は取り消せません。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-schedule">キャンセル</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={() => {
                  deleteMutation.mutate(itemToDelete.id);
                  setItemToDelete(null);
                }}
                data-testid="button-confirm-delete-schedule"
              >
                削除する
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </>
  );
}
