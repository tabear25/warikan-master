import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  OTHER_KIND_LABEL,
  TRANSPORT_MODE_LABEL,
  parseScheduleMetadata,
} from "@/lib/schedule";
import { BedDouble, Loader2, Sparkles, TrainFront } from "lucide-react";
import type {
  Member,
  OtherKind,
  ScheduleCategory,
  ScheduleItem,
  TransportMode,
} from "@shared/schema";
import {
  LIMITS,
  OTHER_KINDS,
  SCHEDULE_CATEGORIES,
  TRANSPORT_MODES,
} from "@shared/schema";

// ---------------------------------------------------------------------------
// スケジュール項目の追加 / 編集ダイアログ。
// URL を入力すると /api/ogp からタイトル・画像を非同期に補完する（失敗しても
// 入力は止めない）。カテゴリ固有の詳細は metadata として送る。
// ---------------------------------------------------------------------------

interface OgpData {
  title: string | null;
  image: string | null;
  description: string | null;
}

interface ScheduleItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  members: Member[];
  item?: ScheduleItem | null; // 指定時は編集モード
}

const CATEGORY_ICON = {
  accommodation: BedDouble,
  transport: TrainFront,
  other: Sparkles,
} as const;

const TITLE_PLACEHOLDER: Record<ScheduleCategory, string> = {
  accommodation: "例：京都グランドホテル",
  transport: "例：新幹線で京都へ",
  other: "例：清水寺を観光",
};

const START_LABEL: Record<ScheduleCategory, string> = {
  accommodation: "チェックイン",
  transport: "出発",
  other: "開始",
};

const END_LABEL: Record<ScheduleCategory, string> = {
  accommodation: "チェックアウト",
  transport: "到着",
  other: "終了",
};

export function ScheduleItemDialog({
  open,
  onOpenChange,
  eventId,
  members,
  item,
}: ScheduleItemDialogProps) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const isEdit = !!item;

  const [category, setCategory] = useState<ScheduleCategory>("accommodation");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [cost, setCost] = useState("");
  const [payerId, setPayerId] = useState("");
  // カテゴリ別詳細
  const [mode, setMode] = useState<TransportMode>("train");
  const [kind, setKind] = useState<OtherKind>("sightseeing");
  const [fromPlace, setFromPlace] = useState("");
  const [toPlace, setToPlace] = useState("");
  const [trainOrFlightNo, setTrainOrFlightNo] = useState("");
  const [seat, setSeat] = useState("");
  const [reservationNumber, setReservationNumber] = useState("");
  const [phone, setPhone] = useState("");
  // OGP
  const [ogp, setOgp] = useState<OgpData | null>(null);
  const [ogpLoading, setOgpLoading] = useState(false);
  const lastFetchedUrl = useRef("");

  // ダイアログを開いたときに初期化（追加 / 編集 両対応）。
  useEffect(() => {
    if (!open) return;
    if (item) {
      const metadata = parseScheduleMetadata(item);
      setCategory(
        (SCHEDULE_CATEGORIES as readonly string[]).includes(item.category)
          ? (item.category as ScheduleCategory)
          : "other",
      );
      setTitle(item.title);
      setUrl(item.url ?? "");
      setStartAt(item.startAt ?? "");
      setEndAt(item.endAt ?? "");
      setAddress(item.address ?? "");
      setMemo(item.memo ?? "");
      setCost(item.cost != null ? String(Math.round(item.cost)) : "");
      setPayerId(item.payerId != null ? String(item.payerId) : "");
      setMode(metadata.mode ?? "train");
      setKind(metadata.kind ?? "sightseeing");
      setFromPlace(metadata.from ?? "");
      setToPlace(metadata.to ?? "");
      setTrainOrFlightNo(metadata.trainOrFlightNo ?? "");
      setSeat(metadata.seat ?? "");
      setReservationNumber(metadata.reservationNumber ?? "");
      setPhone(metadata.phone ?? "");
      setOgp(
        item.ogpTitle || item.ogpImage || item.ogpDescription
          ? { title: item.ogpTitle, image: item.ogpImage, description: item.ogpDescription }
          : null,
      );
      lastFetchedUrl.current = item.url ?? "";
    } else {
      setCategory("accommodation");
      setTitle("");
      setUrl("");
      setStartAt("");
      setEndAt("");
      setAddress("");
      setMemo("");
      setCost("");
      setPayerId("");
      setMode("train");
      setKind("sightseeing");
      setFromPlace("");
      setToPlace("");
      setTrainOrFlightNo("");
      setSeat("");
      setReservationNumber("");
      setPhone("");
      setOgp(null);
      lastFetchedUrl.current = "";
    }
    setOgpLoading(false);
  }, [open, item]);

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const targetUrl = isEdit
        ? `/api/events/${eventId}/schedule/${item!.id}`
        : `/api/events/${eventId}/schedule`;
      const res = await apiRequest(isEdit ? "PATCH" : "POST", targetUrl, data);
      return res.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "schedule"] });
      toast({ title: isEdit ? "予定を更新しました" : "予定を追加しました" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  // URL 欄からフォーカスが外れたら OGP を取得する（N-UX-6: 失敗しても止めない）。
  const fetchOgp = async () => {
    const targetUrl = url.trim();
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) return;
    if (targetUrl === lastFetchedUrl.current) return;
    lastFetchedUrl.current = targetUrl;
    setOgpLoading(true);
    try {
      const res = await apiRequest("POST", "/api/ogp", { url: targetUrl });
      const data = (await res.json()) as OgpData & { siteName: string | null };
      setOgp({ title: data.title, image: data.image, description: data.description });
      if (data.title) {
        // タイトルが空のときだけ自動補完する（入力済みの値は上書きしない）。
        setTitle((prev) => (prev.trim() ? prev : data.title!.slice(0, LIMITS.scheduleTitle)));
      }
    } catch {
      setOgp(null);
    } finally {
      setOgpLoading(false);
    }
  };

  const trimmedOrUndefined = (value: string): string | undefined => {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };

  const buildMetadata = (): Record<string, unknown> => {
    if (category === "accommodation") {
      return {
        reservationNumber: trimmedOrUndefined(reservationNumber),
        phone: trimmedOrUndefined(phone),
      };
    }
    if (category === "transport") {
      return {
        mode,
        from: trimmedOrUndefined(fromPlace),
        to: trimmedOrUndefined(toPlace),
        trainOrFlightNo: trimmedOrUndefined(trainOrFlightNo),
        seat: trimmedOrUndefined(seat),
        reservationNumber: trimmedOrUndefined(reservationNumber),
      };
    }
    return {
      kind,
      reservationNumber: trimmedOrUndefined(reservationNumber),
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: "タイトルを入力してください", variant: "destructive" });
      return;
    }
    if (startAt && endAt && endAt < startAt) {
      toast({ title: "日時が正しくありません", description: `${END_LABEL[category]}は${START_LABEL[category]}以降にしてください`, variant: "destructive" });
      return;
    }
    let costNumber: number | undefined;
    if (cost.trim()) {
      costNumber = Math.round(parseFloat(cost));
      if (!Number.isFinite(costNumber) || costNumber <= 0) {
        toast({ title: "金額は1円以上で入力してください", variant: "destructive" });
        return;
      }
    }

    // URL を変更したまま OGP 未取得の場合、古い OGP を送らない。
    const ogpFresh = url.trim() === lastFetchedUrl.current ? ogp : null;

    mutation.mutate({
      category,
      title: title.trim(),
      url: trimmedOrUndefined(url),
      startAt: trimmedOrUndefined(startAt),
      endAt: trimmedOrUndefined(endAt),
      address: category === "transport" ? undefined : trimmedOrUndefined(address),
      memo: trimmedOrUndefined(memo),
      cost: costNumber,
      payerId: payerId ? parseInt(payerId, 10) : undefined,
      metadata: buildMetadata(),
      ogpTitle: ogpFresh?.title ?? undefined,
      ogpImage: ogpFresh?.image ?? undefined,
      ogpDescription: ogpFresh?.description ?? undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEdit ? "予定を編集" : "予定を追加"}</DialogTitle>
          <DialogDescription className="text-sm">
            宿泊・移動・観光などの予定をみんなで共有できます
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* カテゴリ */}
          <div className="space-y-2">
            <Label className="text-sm">カテゴリ</Label>
            <RadioGroup
              value={category}
              onValueChange={(value) => setCategory(value as ScheduleCategory)}
              className="grid grid-cols-3 gap-2"
            >
              {SCHEDULE_CATEGORIES.map((value) => {
                const Icon = CATEGORY_ICON[value];
                return (
                  <label
                    key={value}
                    htmlFor={`schedule-category-${value}`}
                    className={cn(
                      "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-2.5 text-xs font-semibold transition-all duration-200",
                      category === value
                        ? "border-primary bg-primary/10 text-primary shadow-xs"
                        : "border-border text-muted-foreground hover:border-input hover:text-foreground",
                    )}
                    data-testid={`schedule-category-${value}`}
                  >
                    <RadioGroupItem value={value} id={`schedule-category-${value}`} className="sr-only" />
                    <Icon className="h-4 w-4" />
                    {CATEGORY_LABEL[value]}
                  </label>
                );
              })}
            </RadioGroup>
          </div>

          {/* 移動手段 / 種別 */}
          {category === "transport" && (
            <div className="space-y-1.5">
              <Label className="text-sm">移動手段</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as TransportMode)}>
                <SelectTrigger data-testid="select-transport-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRANSPORT_MODES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {TRANSPORT_MODE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {category === "other" && (
            <div className="space-y-1.5">
              <Label className="text-sm">種別</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as OtherKind)}>
                <SelectTrigger data-testid="select-other-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OTHER_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {OTHER_KIND_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* タイトル */}
          <div className="space-y-1.5">
            <Label htmlFor="schedule-title" className="text-sm">
              タイトル <span className="text-destructive">*</span>
            </Label>
            <Input
              id="schedule-title"
              data-testid="input-schedule-title"
              placeholder={TITLE_PLACEHOLDER[category]}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LIMITS.scheduleTitle}
            />
          </div>

          {/* URL + OGP */}
          <div className="space-y-1.5">
            <Label htmlFor="schedule-url" className="text-sm">URL（任意）</Label>
            <Input
              id="schedule-url"
              data-testid="input-schedule-url"
              type="url"
              inputMode="url"
              placeholder="予約ページなどの URL を貼り付け"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (!e.target.value.trim()) {
                  setOgp(null);
                  lastFetchedUrl.current = "";
                }
              }}
              onBlur={fetchOgp}
              maxLength={LIMITS.url}
              className="text-xs"
            />
            {ogpLoading && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                ページ情報を取得中…
              </p>
            )}
            {!ogpLoading && ogp && (ogp.title || ogp.image) && (
              <div className="flex items-center gap-2.5 rounded-xl bg-accent/50 p-2">
                {ogp.image && (
                  <img
                    src={ogp.image}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                )}
                <p className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground">
                  {ogp.title ?? ogp.description}
                </p>
              </div>
            )}
          </div>

          {/* 日時 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="schedule-start" className="text-sm">{START_LABEL[category]}</Label>
              <Input
                id="schedule-start"
                data-testid="input-schedule-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="schedule-end" className="text-sm">{END_LABEL[category]}</Label>
              <Input
                id="schedule-end"
                data-testid="input-schedule-end"
                type="datetime-local"
                value={endAt}
                min={startAt || undefined}
                onChange={(e) => setEndAt(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* 移動: 出発地・到着地・便名・座席 */}
          {category === "transport" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="transport-from" className="text-sm">出発地</Label>
                  <Input
                    id="transport-from"
                    data-testid="input-transport-from"
                    placeholder="例：東京"
                    value={fromPlace}
                    onChange={(e) => setFromPlace(e.target.value)}
                    maxLength={LIMITS.metaField}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="transport-to" className="text-sm">到着地</Label>
                  <Input
                    id="transport-to"
                    data-testid="input-transport-to"
                    placeholder="例：京都"
                    value={toPlace}
                    onChange={(e) => setToPlace(e.target.value)}
                    maxLength={LIMITS.metaField}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="transport-no" className="text-sm">便名・列車名</Label>
                  <Input
                    id="transport-no"
                    placeholder="例：のぞみ217号"
                    value={trainOrFlightNo}
                    onChange={(e) => setTrainOrFlightNo(e.target.value)}
                    maxLength={LIMITS.metaField}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="transport-seat" className="text-sm">座席</Label>
                  <Input
                    id="transport-seat"
                    placeholder="例：13号車 3-A"
                    value={seat}
                    onChange={(e) => setSeat(e.target.value)}
                    maxLength={LIMITS.metaField}
                  />
                </div>
              </div>
            </>
          )}

          {/* 住所（移動以外） */}
          {category !== "transport" && (
            <div className="space-y-1.5">
              <Label htmlFor="schedule-address" className="text-sm">住所（任意）</Label>
              <Input
                id="schedule-address"
                data-testid="input-schedule-address"
                placeholder="例：京都府京都市東山区清水1丁目294"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={LIMITS.address}
              />
              <p className="text-xs text-muted-foreground">入力すると Google マップへのリンクが表示されます</p>
            </div>
          )}

          {/* 予約番号（+ 宿泊は電話番号） */}
          {category === "accommodation" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-reservation" className="text-sm">予約番号</Label>
                <Input
                  id="schedule-reservation"
                  placeholder="例：ABC123"
                  value={reservationNumber}
                  onChange={(e) => setReservationNumber(e.target.value)}
                  maxLength={LIMITS.metaField}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="schedule-phone" className="text-sm">電話番号</Label>
                <Input
                  id="schedule-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="例：075-000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={LIMITS.metaField}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="schedule-reservation" className="text-sm">予約番号（任意）</Label>
              <Input
                id="schedule-reservation"
                placeholder="例：ABC123"
                value={reservationNumber}
                onChange={(e) => setReservationNumber(e.target.value)}
                maxLength={LIMITS.metaField}
              />
            </div>
          )}

          {/* メモ */}
          <div className="space-y-1.5">
            <Label htmlFor="schedule-memo" className="text-sm">メモ（任意）</Label>
            <Textarea
              id="schedule-memo"
              data-testid="input-schedule-memo"
              placeholder="持ち物や集合場所など"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={LIMITS.memo}
              rows={2}
              className="rounded-xl"
            />
          </div>

          {/* 割り勘連携 */}
          <div className="space-y-3 rounded-2xl border border-dashed border-primary/30 bg-primary/[0.03] p-3.5">
            <p className="text-xs font-semibold text-primary">割り勘連携（任意）</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="schedule-cost" className="text-sm">金額（円）</Label>
                <Input
                  id="schedule-cost"
                  data-testid="input-schedule-cost"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  placeholder="例：24000"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  className="font-display text-sm font-semibold tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">支払った人</Label>
                <Select
                  value={payerId || "none"}
                  onValueChange={(value) => setPayerId(value === "none" ? "" : value)}
                >
                  <SelectTrigger data-testid="select-schedule-payer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未定</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={String(member.id)}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              金額を入れておくと、あとからワンタップで割り勘に追加できます
            </p>
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={mutation.isPending}
            data-testid="button-submit-schedule"
          >
            {mutation.isPending ? "保存中..." : isEdit ? "更新する" : "追加する"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
