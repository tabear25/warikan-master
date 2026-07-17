import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { toPng } from "html-to-image";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveDialog } from "@/components/responsive-dialog";
import { useMediaQuery, DESKTOP_QUERY } from "@/hooks/use-media-query";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { Aurora } from "@/components/aurora";
import { MemberAvatar } from "@/components/member-avatar";
import { ScheduleTab } from "@/components/schedule-tab";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_ICON, EVENT_TYPE_LABEL, formatShortDate } from "@/lib/schedule";
import {
  Plus, PlusCircle, Trash2, Users, Receipt, ArrowRight, CheckCircle2,
  Wallet, Pencil, Share2, Copy, Check, UserPlus, FileDown, Image as ImageIcon, ClipboardCopy,
  Scale, Coins, SplitSquareHorizontal, KeyRound, CalendarDays,
} from "lucide-react";
import type { Event, EventType, Member, Payment, SplitMode } from "@shared/schema";
import { EVENT_TYPES } from "@shared/schema";
import { splitYen } from "@shared/split";
import { formatYen, formatSignedYen } from "@/lib/currency";
import {
  buildSettlementCsv,
  buildSettlementText,
  copyToClipboard,
  downloadTextFile,
  triggerDownload,
  safeFileName,
} from "@/lib/export";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  equal: "均等",
  ratio: "比率",
  amount: "金額指定",
};

// ---------------------------------------------------------------------------
// 支払いの追加 / 編集ダイアログ（割り勘モード対応）
// ---------------------------------------------------------------------------

// スケジュール項目 →「割り勘に追加」で開くときのプリフィル内容。
interface PaymentPrefill {
  amount?: number;
  description?: string;
  payerId?: number;
  scheduleItemId: number;
}

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  members: Member[];
  payment?: Payment | null; // 指定時は編集モード
  prefill?: PaymentPrefill | null; // スケジュールからの変換時に指定
}

function PaymentDialog({ open, onOpenChange, eventId, members, payment, prefill }: PaymentDialogProps) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const isEdit = !!payment;

  const [payerId, setPayerId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [amounts, setAmounts] = useState<Record<number, string>>({});

  // ダイアログを開いたときに初期化（追加 / 編集 両対応）。
  useEffect(() => {
    if (!open) return;
    if (payment) {
      const splitIds: number[] = JSON.parse(payment.splitMemberIds);
      setPayerId(String(payment.payerId));
      setAmount(String(Math.round(payment.amount)));
      setDescription(payment.description);
      const mode = (payment.splitMode ?? "equal") as SplitMode;
      setSplitMode(mode);
      setSelectedIds(splitIds);
      const detail: Record<string, number> = payment.splitDetails ? JSON.parse(payment.splitDetails) : {};
      setWeights(Object.fromEntries(splitIds.map((id) => [id, String(mode === "ratio" ? detail[String(id)] ?? 1 : 1)])));
      setAmounts(Object.fromEntries(splitIds.map((id) => [id, mode === "amount" ? String(detail[String(id)] ?? "") : ""])));
    } else {
      const allIds = members.map((m) => m.id);
      setPayerId(prefill?.payerId != null ? String(prefill.payerId) : "");
      setAmount(prefill?.amount != null ? String(Math.round(prefill.amount)) : "");
      setDescription(prefill?.description ?? "");
      setSplitMode("equal");
      setSelectedIds(allIds);
      setWeights(Object.fromEntries(allIds.map((id) => [id, "1"])));
      setAmounts(Object.fromEntries(allIds.map((id) => [id, ""])));
    }
  }, [open, payment, prefill, members]);

  const paymentsKey = ["/api/events", eventId, "payments"];

  // 楽観更新：ダイアログを閉じて一覧へ即時反映し、失敗した場合のみ巻き戻す
  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const url = isEdit
        ? `/api/events/${eventId}/payments/${payment!.id}`
        : `/api/events/${eventId}/payments`;
      const res = await apiRequest(isEdit ? "PATCH" : "POST", url, data);
      return res.json();
    },
    onMutate: async (data) => {
      await queryClientHook.cancelQueries({ queryKey: paymentsKey });
      const prev = queryClientHook.getQueryData<Payment[]>(paymentsKey);
      const optimistic: Payment = {
        id: payment?.id ?? -Date.now(),
        eventId,
        payerId: data.payerId as number,
        amount: data.amount as number,
        description: data.description as string,
        splitMemberIds: JSON.stringify(data.splitMemberIds),
        splitMode: data.splitMode as string,
        splitDetails: data.weights
          ? JSON.stringify(data.weights)
          : data.amounts
            ? JSON.stringify(data.amounts)
            : null,
        scheduleItemId: (data.scheduleItemId as number | undefined) ?? payment?.scheduleItemId ?? null,
        createdAt: payment?.createdAt ?? new Date().toISOString(),
      };
      queryClientHook.setQueryData<Payment[]>(paymentsKey, (old = []) =>
        isEdit ? old.map((p) => (p.id === payment!.id ? optimistic : p)) : [...old, optimistic],
      );
      onOpenChange(false);
      toast({ title: isEdit ? "支払いを更新しました" : "支払いを追加しました" });
      return { prev };
    },
    onError: (err: Error, _data, ctx) => {
      if (ctx?.prev) queryClientHook.setQueryData(paymentsKey, ctx.prev);
      toast({
        title: "保存できませんでした（元に戻しました）",
        description: err.message.replace(/^\d+: /, ""),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClientHook.invalidateQueries({ queryKey: paymentsKey });
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
      if (prefill) {
        // 変換済みバッジ（paymentId リンク）を反映する
        queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "schedule"] });
      }
    },
  });

  const toggleMember = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const amountNum = Math.round(parseFloat(amount));
  const orderedSelected = members.map((m) => m.id).filter((id) => selectedIds.includes(id));

  // プレビュー：各参加者の負担額（整数円、合計＝金額）。
  const preview = useMemo<Map<number, number>>(() => {
    if (!Number.isFinite(amountNum) || amountNum <= 0 || orderedSelected.length === 0) return new Map();
    if (splitMode === "equal") return splitYen(amountNum, orderedSelected);
    if (splitMode === "ratio") {
      const w: Record<number, number> = {};
      orderedSelected.forEach((id) => { w[id] = Math.max(0, parseFloat(weights[id] ?? "0") || 0); });
      return splitYen(amountNum, orderedSelected, w);
    }
    const map = new Map<number, number>();
    orderedSelected.forEach((id) => map.set(id, Math.round(parseFloat(amounts[id] ?? "0") || 0)));
    return map;
  }, [amountNum, orderedSelected, splitMode, weights, amounts]);

  const amountsSum = splitMode === "amount"
    ? orderedSelected.reduce((acc, id) => acc + (Math.round(parseFloat(amounts[id] ?? "0") || 0)), 0)
    : 0;
  const amountsMatch = splitMode !== "amount" || amountsSum === amountNum;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payerId || !Number.isFinite(amountNum) || amountNum <= 0 || !description.trim()) {
      toast({ title: "入力が不完全です", description: "すべての項目を入力してください", variant: "destructive" });
      return;
    }
    if (orderedSelected.length === 0) {
      toast({ title: "割り勘対象を選んでください", variant: "destructive" });
      return;
    }
    if (splitMode === "amount" && !amountsMatch) {
      toast({ title: "内訳が金額と一致しません", description: `内訳合計 ¥${amountsSum.toLocaleString("ja-JP")} / 金額 ¥${(amountNum || 0).toLocaleString("ja-JP")}`, variant: "destructive" });
      return;
    }
    if (splitMode === "ratio" && orderedSelected.every((id) => (parseFloat(weights[id] ?? "0") || 0) <= 0)) {
      toast({ title: "比率を入力してください", variant: "destructive" });
      return;
    }

    const base = {
      payerId: parseInt(payerId, 10),
      amount: amountNum,
      description: description.trim(),
      splitMemberIds: orderedSelected,
      splitMode,
      // スケジュール項目からの変換時は双方向リンク用の ID を添える（新規追加時のみ）
      ...(!isEdit && prefill ? { scheduleItemId: prefill.scheduleItemId } : {}),
    };
    if (splitMode === "ratio") {
      const w: Record<string, number> = {};
      orderedSelected.forEach((id) => { w[String(id)] = Math.max(0, parseFloat(weights[id] ?? "0") || 0); });
      mutation.mutate({ ...base, weights: w });
    } else if (splitMode === "amount") {
      const a: Record<string, number> = {};
      orderedSelected.forEach((id) => { a[String(id)] = Math.round(parseFloat(amounts[id] ?? "0") || 0); });
      mutation.mutate({ ...base, amounts: a });
    } else {
      mutation.mutate(base);
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "支払いを編集" : "支払いを追加"}
      description={!isEdit && prefill ? "スケジュールの項目を割り勘として記録します" : "誰が何をいくら払ったか記録します"}
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label className="text-sm">支払った人</Label>
            <div className="flex flex-wrap gap-1.5" data-testid="select-payer" role="radiogroup" aria-label="支払った人">
              {members.map((m) => {
                const active = payerId === String(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => setPayerId(String(m.id))}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-xs font-semibold transition-all duration-150",
                      active
                        ? "border-primary bg-primary/10 text-primary shadow-xs"
                        : "border-border text-muted-foreground hover:border-input hover:text-foreground",
                    )}
                    role="radio"
                    aria-checked={active}
                    data-testid={`option-payer-${m.id}`}
                  >
                    <MemberAvatar name={m.name} className="h-6 w-6 text-[10px]" />
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount" className="text-sm">金額（円）</Label>
            <Input
              id="amount"
              data-testid="input-amount"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="例：3500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-display text-base font-semibold tabular-nums"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-sm">説明</Label>
            <Input
              id="description"
              data-testid="input-description"
              placeholder="例：夕食代"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* 割り勘モード */}
          <div className="space-y-2">
            <Label className="text-sm">割り勘の方法</Label>
            <RadioGroup
              value={splitMode}
              onValueChange={(v) => setSplitMode(v as SplitMode)}
              className="grid grid-cols-3 gap-2"
            >
              {([
                { value: "equal", label: "均等", icon: SplitSquareHorizontal },
                { value: "ratio", label: "比率", icon: Scale },
                { value: "amount", label: "金額指定", icon: Coins },
              ] as const).map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  htmlFor={`mode-${value}`}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-2.5 text-xs font-semibold transition-all duration-200",
                    splitMode === value
                      ? "border-primary bg-primary/10 text-primary shadow-xs"
                      : "border-border text-muted-foreground hover:border-input hover:text-foreground",
                  )}
                  data-testid={`split-mode-${value}`}
                >
                  <RadioGroupItem value={value} id={`mode-${value}`} className="sr-only" />
                  <Icon className="h-4 w-4" />
                  {label}
                </label>
              ))}
            </RadioGroup>
          </div>

          {/* 割り勘対象 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">割り勘する人</Label>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(selectedIds.length === members.length ? [] : members.map((m) => m.id))
                }
                className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
                data-testid="button-toggle-all-members"
              >
                {selectedIds.length === members.length ? "全員をはずす" : "全員を選ぶ"}
              </button>
            </div>
            <div className="space-y-1">
              {members.map((m) => {
                const checked = selectedIds.includes(m.id);
                const share = preview.get(m.id);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-150",
                      checked ? "bg-accent/60" : "opacity-70",
                    )}
                  >
                    <Checkbox
                      id={`split-member-${m.id}`}
                      data-testid={`checkbox-split-member-${m.id}`}
                      checked={checked}
                      onCheckedChange={() => toggleMember(m.id)}
                    />
                    <MemberAvatar name={m.name} className="h-6 w-6 text-[10px]" />
                    <label htmlFor={`split-member-${m.id}`} className="flex-1 cursor-pointer truncate text-sm font-medium">{m.name}</label>
                    {checked && splitMode === "ratio" && (
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        className="h-8 w-16 rounded-lg px-2 text-center text-xs tabular-nums"
                        value={weights[m.id] ?? ""}
                        onChange={(e) => setWeights((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        data-testid={`weight-${m.id}`}
                        aria-label={`${m.name} の比率`}
                      />
                    )}
                    {checked && splitMode === "amount" && (
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        className="h-8 w-20 rounded-lg px-2 text-right text-xs tabular-nums"
                        placeholder="円"
                        value={amounts[m.id] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        data-testid={`amount-${m.id}`}
                        aria-label={`${m.name} の金額`}
                      />
                    )}
                    {checked && splitMode !== "amount" && share !== undefined && (
                      <span className="money w-16 text-right text-xs font-semibold tabular-nums text-muted-foreground">{formatYen(share)}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {splitMode === "amount" && Number.isFinite(amountNum) && amountNum > 0 && (
              <p className={cn("text-right text-xs tabular-nums", amountsMatch ? "text-muted-foreground" : "text-negative")}>
                内訳合計 ¥{amountsSum.toLocaleString("ja-JP")} / 金額 ¥{amountNum.toLocaleString("ja-JP")}
                {!amountsMatch && `（差 ¥${Math.abs(amountNum - amountsSum).toLocaleString("ja-JP")}）`}
              </p>
            )}
          </div>

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={mutation.isPending}
            data-testid="button-submit-payment"
          >
            {mutation.isPending ? "保存中..." : isEdit ? "更新する" : "追加する"}
          </Button>
        </form>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------------------
// メンバー追加ダイアログ
// ---------------------------------------------------------------------------
function AddMemberDialog({ open, onOpenChange, eventId }: { open: boolean; onOpenChange: (v: boolean) => void; eventId: number }) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const [name, setName] = useState("");

  useEffect(() => { if (open) setName(""); }, [open]);

  const membersKey = ["/api/events", eventId, "members"];

  // 楽観更新：メンバーは即座にチップへ現れ、失敗した場合のみ巻き戻す
  const mutation = useMutation({
    mutationFn: async (memberName: string) => {
      const res = await apiRequest("POST", `/api/events/${eventId}/members`, { name: memberName });
      return res.json();
    },
    onMutate: async (memberName) => {
      await queryClientHook.cancelQueries({ queryKey: membersKey });
      const prev = queryClientHook.getQueryData<Member[]>(membersKey);
      queryClientHook.setQueryData<Member[]>(membersKey, (old = []) => [
        ...old,
        { id: -Date.now(), eventId, name: memberName },
      ]);
      onOpenChange(false);
      toast({ title: "メンバーを追加しました" });
      return { prev };
    },
    onError: (err: Error, _name, ctx) => {
      if (ctx?.prev) queryClientHook.setQueryData(membersKey, ctx.prev);
      toast({
        title: "追加できませんでした（元に戻しました）",
        description: err.message.replace(/^\d+: /, ""),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClientHook.invalidateQueries({ queryKey: membersKey });
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
    },
  });

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="メンバーを追加"
      description="後から参加する人を追加できます"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) mutation.mutate(name.trim()); }}
        className="space-y-4 pt-1"
      >
        <Input
          placeholder="名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="input-new-member"
          autoFocus
        />
        <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending || !name.trim()} data-testid="button-submit-member">
          {mutation.isPending ? "追加中..." : "追加する"}
        </Button>
      </form>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------------------
// 共有ダイアログ（リンク + QR コード）
// ---------------------------------------------------------------------------
function ShareDialog({ open, onOpenChange, event }: { open: boolean; onOpenChange: (v: boolean) => void; event: Event }) {
  const { toast } = useToast();
  const [qr, setQr] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}${window.location.pathname}#/event/${event.id}`;

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    QRCode.toDataURL(shareUrl, { width: 220, margin: 1 })
      .then(setQr)
      .catch(() => setQr(""));
  }, [open, shareUrl]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(shareUrl);
    setCopied(ok);
    toast({ title: ok ? "リンクをコピーしました" : "コピーに失敗しました", variant: ok ? undefined : "destructive" });
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="イベントを共有"
      description="リンクや QR コードで仲間を招待できます"
    >
      <div className="space-y-4">
          {qr && (
            <div className="flex justify-center">
              {/* QR は読み取り精度のため常に白地に載せる */}
              <div className="rounded-2xl border border-card-border bg-white p-3 shadow-sm">
                <img src={qr} alt="QRコード" className="rounded-lg" width={172} height={172} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-sm">共有リンク</Label>
            <div className="flex gap-2">
              <Input readOnly value={shareUrl} className="text-xs" data-testid="input-share-url" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={handleCopy} data-testid="button-copy-link" aria-label="リンクをコピー">
                {copied ? <Check className="h-4 w-4 text-positive" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-accent/60 p-3 text-xs text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              合言葉でも参加できます： <span className="font-display font-bold text-foreground">{event.keyword}</span>
            </span>
          </div>
      </div>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------------------
// イベント設定ダイアログ（種類・旅行日程の変更）
// ---------------------------------------------------------------------------
function EventSettingsDialog({ open, onOpenChange, event }: { open: boolean; onOpenChange: (v: boolean) => void; event: Event }) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const [type, setType] = useState<EventType>("other");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setType((EVENT_TYPES as readonly string[]).includes(event.type) ? (event.type as EventType) : "other");
    setStartDate(event.startDate ?? "");
    setEndDate(event.endDate ?? "");
  }, [open, event]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/events/${event.id}`, {
        type,
        // 日程は旅行タイプのときだけ保持し、それ以外はクリアする
        startDate: type === "trip" && startDate ? startDate : null,
        endDate: type === "trip" && endDate ? endDate : null,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", event.id] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/admin/events"] });
      toast({ title: "イベント設定を更新しました" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (type === "trip" && startDate && endDate && endDate < startDate) {
      toast({ title: "日程が正しくありません", description: "終了日は開始日以降にしてください", variant: "destructive" });
      return;
    }
    mutation.mutate();
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="イベント設定"
      description="イベントの種類と日程を変更できます"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label className="text-sm">イベントの種類</Label>
            <RadioGroup
              value={type}
              onValueChange={(value) => setType(value as EventType)}
              className="grid grid-cols-3 gap-2"
            >
              {EVENT_TYPES.map((value) => {
                const Icon = EVENT_TYPE_ICON[value];
                return (
                  <label
                    key={value}
                    htmlFor={`settings-type-${value}`}
                    className={cn(
                      "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-2.5 text-xs font-semibold transition-all duration-200",
                      type === value
                        ? "border-primary bg-primary/10 text-primary shadow-xs"
                        : "border-border text-muted-foreground hover:border-input hover:text-foreground",
                    )}
                    data-testid={`settings-type-${value}`}
                  >
                    <RadioGroupItem value={value} id={`settings-type-${value}`} className="sr-only" />
                    <Icon className="h-4 w-4" />
                    {EVENT_TYPE_LABEL[value]}
                  </label>
                );
              })}
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              「旅行」にするとスケジュールタブが使えます。種類を変えても登録済みの予定は消えません。
            </p>
          </div>

          {type === "trip" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="settings-trip-start" className="text-sm">開始日（任意）</Label>
                <Input
                  id="settings-trip-start"
                  data-testid="input-settings-trip-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-trip-end" className="text-sm">終了日（任意）</Label>
                <Input
                  id="settings-trip-end"
                  data-testid="input-settings-trip-end"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={mutation.isPending}
            data-testid="button-save-event-settings"
          >
            {mutation.isPending ? "保存中..." : "保存する"}
          </Button>
        </form>
    </ResponsiveDialog>
  );
}

// ---------------------------------------------------------------------------
// 各自の収支バー
// ---------------------------------------------------------------------------
function BalanceBar({ name, balance, max }: { name: string; balance: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(balance) / max) * 100) : 0;
  const positive = balance >= 0;
  return (
    <div className="space-y-1.5" data-testid={`balance-${name}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <MemberAvatar name={name} className="h-6 w-6 text-[10px]" />
          <span className="truncate font-medium text-foreground">{name}</span>
        </span>
        <span className={cn("money font-bold tabular-nums", positive ? "text-positive" : "text-negative")}>
          {formatSignedYen(balance)}
        </span>
      </div>
      <div className="relative flex h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="flex w-1/2 justify-end">
          {!positive && (
            <div
              className="h-full rounded-l-full bg-gradient-to-l from-negative/60 to-negative"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <div className="flex w-1/2 justify-start">
          {positive && (
            <div
              className="h-full rounded-r-full bg-gradient-to-r from-positive/60 to-positive"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 精算セクション（モバイル＝タブ内 / デスクトップ＝右カラム常時表示 で共用）
// ---------------------------------------------------------------------------
interface SettlementData {
  transfers: Array<{ from: string; to: string; amount: number }>;
  balances: Record<number, number>;
}

interface SettlementSectionProps {
  isLoading: boolean;
  event: Event | undefined;
  memberList: Member[];
  paymentCount: number;
  totalSpent: number;
  perPersonAvg: number;
  maxAbsBalance: number;
  settlement: SettlementData | undefined;
  settlementRef: React.RefObject<HTMLDivElement>;
  exportingImage: boolean;
  onCopySummary: () => void;
  onDownloadCsv: () => void;
  onDownloadImage: () => void;
  settlePending: boolean;
  onSettleClick: () => void;
}

function SettlementSection({
  isLoading,
  event,
  memberList,
  paymentCount,
  totalSpent,
  perPersonAvg,
  maxAbsBalance,
  settlement,
  settlementRef,
  exportingImage,
  onCopySummary,
  onDownloadCsv,
  onDownloadImage,
  settlePending,
  onSettleClick,
}: SettlementSectionProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardContent className="pb-4 pt-4"><Skeleton className="h-5 w-full" /></CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (paymentCount === 0) {
    return (
      <motion.div {...fadeUp} transition={{ duration: 0.4, ease: EASE }}>
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
              <Wallet className="h-7 w-7" />
            </div>
            <p className="mb-1 text-sm font-semibold text-foreground">支払いを追加してください</p>
            <p className="text-xs text-muted-foreground">支払いを記録すると精算結果が表示されます</p>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      <div ref={settlementRef} className="space-y-4 bg-background">
        {/* Summary stats */}
        <motion.div
          className="grid grid-cols-3 gap-2"
          {...fadeUp}
          transition={{ duration: 0.45, ease: EASE }}
        >
          <Card className="border-transparent bg-gradient-brand text-primary-foreground shadow-glow">
            <CardContent className="p-3 text-center">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">総支出</p>
              <p className="money text-sm font-bold tabular-nums">{formatYen(totalSpent)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">件数</p>
              <p className="money text-sm font-bold tabular-nums text-foreground">{paymentCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1人平均</p>
              <p className="money text-sm font-bold tabular-nums text-foreground">{formatYen(perPersonAvg)}</p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Balance bars */}
        {settlement && memberList.length > 0 && (
          <motion.div {...fadeUp} transition={{ duration: 0.45, ease: EASE, delay: 0.06 }}>
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-bold">各自の収支</CardTitle>
                <CardDescription className="text-xs">プラスは受け取り、マイナスは支払い</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5 pb-4">
                {memberList.map((m) => (
                  <BalanceBar key={m.id} name={m.name} balance={Math.round(settlement.balances[m.id] ?? 0)} max={maxAbsBalance} />
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Transfers */}
        {settlement?.transfers.length === 0 ? (
          <motion.div {...fadeUp} transition={{ duration: 0.45, ease: EASE, delay: 0.12 }}>
            <Card className="border-positive/20 bg-positive/5">
              <CardContent className="py-6 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-positive/15 text-positive">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-foreground">精算不要！</p>
                <p className="text-xs text-muted-foreground">全員の収支はすでにバランスが取れています</p>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div {...fadeUp} transition={{ duration: 0.45, ease: EASE, delay: 0.12 }}>
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-bold">送金リスト</CardTitle>
                <CardDescription className="text-xs">最小の回数で精算できます</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 pb-4">
                {settlement?.transfers.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl bg-accent/50 p-2.5" data-testid={`transfer-${i}`}>
                    <MemberAvatar name={t.from} className="h-7 w-7 text-[10px]" />
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.from}</span>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                    <MemberAvatar name={t.to} className="h-7 w-7 text-[10px]" />
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.to}</span>
                    <span className="money ml-auto shrink-0 text-sm font-bold tabular-nums text-positive">{formatYen(t.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Export actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" size="sm" onClick={onCopySummary} data-testid="button-copy-summary">
          <ClipboardCopy className="h-4 w-4" /> コピー
        </Button>
        <Button variant="outline" size="sm" onClick={onDownloadCsv} data-testid="button-download-csv">
          <FileDown className="h-4 w-4" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={onDownloadImage} disabled={exportingImage} data-testid="button-download-image">
          <ImageIcon className="h-4 w-4" /> {exportingImage ? "..." : "画像"}
        </Button>
      </div>

      {/* Settle */}
      {!event?.isSettled ? (
        <Button
          size="lg"
          className="w-full"
          onClick={onSettleClick}
          disabled={settlePending}
          data-testid="button-settle"
        >
          <CheckCircle2 className="h-4 w-4" />
          {settlePending ? "精算中..." : "精算する"}
        </Button>
      ) : (
        <Card className="border-positive/20 bg-positive/5">
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">精算済み</p>
              <p className="text-xs text-muted-foreground">このイベントは精算が完了しています</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = parseInt(id ?? "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [paymentPrefill, setPaymentPrefill] = useState<PaymentPrefill | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("payments");
  const [settleConfirmOpen, setSettleConfirmOpen] = useState(false);
  const [keywordCopied, setKeywordCopied] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const settlementRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const eventQuery = useQuery<Event>({
    queryKey: ["/api/events", eventId],
    queryFn: async () => (await apiRequest("GET", `/api/events/${eventId}`)).json(),
    enabled: !isNaN(eventId) && eventId > 0,
  });

  const membersQuery = useQuery<Member[]>({
    queryKey: ["/api/events", eventId, "members"],
    queryFn: async () => (await apiRequest("GET", `/api/events/${eventId}/members`)).json(),
    enabled: !isNaN(eventId) && eventId > 0,
  });

  const paymentsQuery = useQuery<Payment[]>({
    queryKey: ["/api/events", eventId, "payments"],
    queryFn: async () => (await apiRequest("GET", `/api/events/${eventId}/payments`)).json(),
    enabled: !isNaN(eventId) && eventId > 0,
  });

  const settlementQuery = useQuery<{ transfers: Array<{ from: string; to: string; amount: number }>; balances: Record<number, number> }>({
    queryKey: ["/api/events", eventId, "settlement"],
    queryFn: async () => (await apiRequest("GET", `/api/events/${eventId}/settlement`)).json(),
    enabled: !isNaN(eventId) && eventId > 0,
  });

  // 楽観更新：一覧から即座に消し、失敗した場合のみ巻き戻す
  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId: number) => {
      await apiRequest("DELETE", `/api/events/${eventId}/payments/${paymentId}`);
    },
    onMutate: async (paymentId) => {
      const paymentsKey = ["/api/events", eventId, "payments"];
      await queryClientHook.cancelQueries({ queryKey: paymentsKey });
      const prev = queryClientHook.getQueryData<Payment[]>(paymentsKey);
      queryClientHook.setQueryData<Payment[]>(paymentsKey, (old = []) => old.filter((p) => p.id !== paymentId));
      toast({ title: "支払いを削除しました" });
      return { prev };
    },
    onError: (err: Error, _id, ctx) => {
      if (ctx?.prev) queryClientHook.setQueryData(["/api/events", eventId, "payments"], ctx.prev);
      toast({
        title: "削除できませんでした（元に戻しました）",
        description: err.message.replace(/^\d+: /, ""),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "payments"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
      // スケジュール由来の支払いを消した場合、項目側の「追加済み」を解除表示する
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "schedule"] });
    },
  });

  const settleMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/events/${eventId}/settle`)).json(),
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId] });
      toast({ title: "精算が完了しました！", description: "このイベントは精算済みになりました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  const event = eventQuery.data;
  const memberList = membersQuery.data ?? [];
  const paymentList = paymentsQuery.data ?? [];
  const settlement = settlementQuery.data;

  const isTrip = event?.type === "trip";
  const eventTypeKey: EventType =
    event && (EVENT_TYPES as readonly string[]).includes(event.type) ? (event.type as EventType) : "other";
  const EventTypeIcon = EVENT_TYPE_ICON[eventTypeKey];
  const tripRange = event?.startDate
    ? `${formatShortDate(event.startDate)}${event.endDate ? ` – ${formatShortDate(event.endDate)}` : ""}`
    : null;

  // イベントの種類が旅行以外に変わったら、スケジュールタブから支払いタブへ退避する。
  useEffect(() => {
    if (activeTab === "schedule" && event && event.type !== "trip") {
      setActiveTab("payments");
    }
  }, [activeTab, event]);

  // デスクトップでは精算が右カラムに常時表示されるため、タブ選択からは外す。
  useEffect(() => {
    if (isDesktop && activeTab === "settlement") {
      setActiveTab("payments");
    }
  }, [isDesktop, activeTab]);

  const getMemberName = (memberId: number) => memberList.find((m) => m.id === memberId)?.name ?? "不明";

  const totalSpent = useMemo(() => paymentList.reduce((acc, p) => acc + Math.round(p.amount), 0), [paymentList]);
  const perPersonAvg = memberList.length > 0 ? Math.round(totalSpent / memberList.length) : 0;
  const maxAbsBalance = useMemo(
    () => Math.max(1, ...memberList.map((m) => Math.abs(Math.round(settlement?.balances[m.id] ?? 0)))),
    [memberList, settlement],
  );

  const sortedPayments = useMemo(
    () => [...paymentList].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [paymentList],
  );

  const handleCopyKeyword = async () => {
    if (!event) return;
    const ok = await copyToClipboard(event.keyword);
    setKeywordCopied(ok);
    toast({ title: ok ? "合言葉をコピーしました" : "コピーに失敗しました", variant: ok ? undefined : "destructive" });
    if (ok) setTimeout(() => setKeywordCopied(false), 2000);
  };

  const exportData = event && settlement
    ? { eventName: event.name, members: memberList, balances: settlement.balances, transfers: settlement.transfers }
    : null;

  const handleCopySummary = async () => {
    if (!exportData) return;
    const ok = await copyToClipboard(buildSettlementText(exportData));
    toast({ title: ok ? "精算結果をコピーしました" : "コピーに失敗しました", variant: ok ? undefined : "destructive" });
  };

  const handleDownloadCsv = () => {
    if (!exportData || !event) return;
    downloadTextFile(`${safeFileName(event.name)}_精算.csv`, buildSettlementCsv(exportData), "text/csv;charset=utf-8");
    toast({ title: "CSVをダウンロードしました" });
  };

  const handleDownloadImage = async () => {
    if (!settlementRef.current || !event) return;
    setExportingImage(true);
    try {
      const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
      const dataUrl = await toPng(settlementRef.current, { backgroundColor: bg, pixelRatio: 2 });
      triggerDownload(`${safeFileName(event.name)}_精算.png`, dataUrl);
      toast({ title: "画像をダウンロードしました" });
    } catch {
      toast({ title: "画像の生成に失敗しました", variant: "destructive" });
    } finally {
      setExportingImage(false);
    }
  };

  if (isNaN(eventId) || eventId <= 0) {
    return (
      <div className="relative isolate flex min-h-screen items-center justify-center bg-background px-4">
        <Aurora />
        <Card className="w-full max-w-sm rounded-3xl text-center">
          <CardContent className="pb-6 pt-8">
            <p className="mb-4 text-sm text-muted-foreground">無効なイベントIDです</p>
            <Button onClick={() => setLocation("/")} variant="outline">ホームへ戻る</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background">
      <Aurora />

      <AppHeader
        backHref="/"
        title={
          eventQuery.isLoading ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            <span className="max-w-[140px] truncate text-sm font-bold tracking-tight text-foreground">
              {event?.name ?? "イベント"}
            </span>
          )
        }
        actions={
          <>
            {event?.isSettled && (
              <Badge variant="secondary" className="gap-1 text-xs text-positive">
                <CheckCircle2 className="h-3 w-3" />
                精算済み
              </Badge>
            )}
            {event && (
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShareOpen(true)} data-testid="button-share" aria-label="共有">
                <Share2 className="h-4 w-4" />
              </Button>
            )}
          </>
        }
      />

      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-4 lg:max-w-5xl lg:px-6 lg:py-6">
        {/* Keyword & event-type chips */}
        {event && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyKeyword}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 py-1 pl-3 pr-2.5 text-xs text-muted-foreground shadow-xs backdrop-blur-sm transition-colors duration-200 hover:text-foreground"
              data-testid="button-copy-keyword"
            >
              <KeyRound className="h-3 w-3 text-primary" />
              合言葉: <span className="font-display font-bold text-foreground">{event.keyword}</span>
              {keywordCopied ? <Check className="h-3 w-3 text-positive" /> : <Copy className="h-3 w-3" />}
            </button>
            <button
              onClick={() => { if (!event.isSettled) setSettingsOpen(true); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur-sm transition-colors duration-200",
                event.isSettled ? "cursor-default" : "hover:text-foreground",
              )}
              data-testid="button-event-settings"
              aria-label="イベント設定"
            >
              <EventTypeIcon className="h-3 w-3 text-primary" />
              <span className="font-medium text-foreground">{EVENT_TYPE_LABEL[eventTypeKey]}</span>
              {isTrip && tripRange && <span>{tripRange}</span>}
              {!event.isSettled && <Pencil className="h-3 w-3" />}
            </button>
          </div>
        )}

        {/* Members bar */}
        {membersQuery.isLoading ? (
          <div className="mb-4 flex gap-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-20 rounded-full" />)}
          </div>
        ) : memberList.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            {memberList.map((m) => (
              <Badge key={m.id} variant="secondary" className="gap-1.5 py-0.5 pl-1 pr-2.5 text-xs" data-testid={`badge-member-${m.id}`}>
                <MemberAvatar name={m.name} className="h-5 w-5 text-[9px]" />
                {m.name}
              </Badge>
            ))}
            {!event?.isSettled && memberList.length < 50 && (
              <button
                onClick={() => setAddMemberOpen(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary transition-colors duration-200 hover:bg-primary/10"
                data-testid="button-add-member"
              >
                <UserPlus className="h-3.5 w-3.5" /> 追加
              </button>
            )}
          </div>
        )}

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full min-w-0">
          <TabsList
            className={cn(
              "mb-4 grid w-full",
              isDesktop
                ? isTrip ? "grid-cols-2" : "hidden"
                : isTrip ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            <TabsTrigger value="payments" data-testid="tab-payments">
              <Receipt className="mr-1.5 h-4 w-4" />
              {isTrip && !isDesktop ? "支払い" : "支払い一覧"}
            </TabsTrigger>
            {isTrip && (
              <TabsTrigger value="schedule" data-testid="tab-schedule">
                <CalendarDays className="mr-1.5 h-4 w-4" />
                旅程
              </TabsTrigger>
            )}
            {!isDesktop && (
              <TabsTrigger value="settlement" data-testid="tab-settlement">
                <Wallet className="mr-1.5 h-4 w-4" />
                {isTrip ? "精算" : "精算結果"}
              </TabsTrigger>
            )}
          </TabsList>

          {/* Payments Tab */}
          <TabsContent value="payments">
            {!event?.isSettled && (
              <motion.div {...fadeUp} transition={{ duration: 0.4, ease: EASE }}>
                <Button
                  size="lg"
                  className="mb-4 w-full"
                  onClick={() => { setEditingPayment(null); setPaymentDialogOpen(true); }}
                  data-testid="button-add-payment"
                >
                  <PlusCircle className="h-4 w-4" />
                  支払いを追加
                </Button>
              </motion.div>
            )}

            {/* Summary row */}
            {paymentList.length > 0 && (
              <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>支払い {paymentList.length} 件</span>
                <span>合計 <span className="money font-bold text-foreground tabular-nums">{formatYen(totalSpent)}</span></span>
              </div>
            )}

            {paymentsQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="pb-4 pt-4">
                      <Skeleton className="mb-2 h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : paymentList.length === 0 ? (
              <motion.div {...fadeUp} transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}>
                <Card>
                  <CardContent className="py-12 text-center">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
                      <Receipt className="h-7 w-7" />
                    </div>
                    <p className="mb-1 text-sm font-semibold text-foreground">まだ支払いがありません</p>
                    <p className="text-xs text-muted-foreground">「支払いを追加」ボタンで記録を始めましょう</p>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <div className="space-y-2">
                {sortedPayments.map((p, index) => {
                  const splitIds: number[] = JSON.parse(p.splitMemberIds);
                  const isAllMembers = splitIds.length === memberList.length;
                  const mode = (p.splitMode ?? "equal") as SplitMode;
                  const payerName = getMemberName(p.payerId);
                  return (
                    <motion.div
                      key={p.id}
                      {...fadeUp}
                      transition={{ duration: 0.4, ease: EASE, delay: Math.min(index, 8) * 0.045 }}
                    >
                      <Card data-testid={`card-payment-${p.id}`} className="hover:shadow-md">
                        <CardContent className="flex items-center gap-3 p-4">
                          <MemberAvatar name={payerName} className="h-10 w-10 text-sm" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <p className="truncate text-sm font-semibold text-foreground">{p.description}</p>
                              {p.scheduleItemId != null && (
                                <CalendarDays className="h-3 w-3 shrink-0 text-primary" aria-label="スケジュール由来の支払い" />
                              )}
                              {mode !== "equal" && (
                                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{SPLIT_MODE_LABEL[mode]}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {payerName} が支払い ·{" "}
                              {isAllMembers && mode === "equal"
                                ? "全員で割り勘"
                                : `${splitIds.map((memberId) => getMemberName(memberId)).join("、")} で割り勘`}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="money text-base font-bold tabular-nums text-foreground">{formatYen(p.amount)}</span>
                            {!event?.isSettled && (
                              <div className="flex gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
                                  onClick={() => { setEditingPayment(p); setPaymentDialogOpen(true); }}
                                  data-testid={`button-edit-payment-${p.id}`}
                                  aria-label="支払いを編集"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
                                  onClick={() => setPaymentToDelete(p)}
                                  disabled={deletePaymentMutation.isPending}
                                  data-testid={`button-delete-payment-${p.id}`}
                                  aria-label="支払いを削除"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            )}

            <AlertDialog
              open={paymentToDelete !== null}
              onOpenChange={(o) => { if (!o) setPaymentToDelete(null); }}
            >
              {paymentToDelete && (
                <AlertDialogContent data-testid="dialog-delete-payment">
                  <AlertDialogHeader>
                    <AlertDialogTitle>この支払いを削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                      {formatYen(paymentToDelete.amount)}（{getMemberName(paymentToDelete.payerId)}）
                      {paymentToDelete.description} を削除します。この操作は取り消せません。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete-payment">キャンセル</AlertDialogCancel>
                    <AlertDialogAction
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={() => {
                        deletePaymentMutation.mutate(paymentToDelete.id);
                        setPaymentToDelete(null);
                      }}
                      data-testid="button-confirm-delete-payment"
                    >
                      削除する
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              )}
            </AlertDialog>
          </TabsContent>

          {/* Schedule Tab（旅行タイプのみ） */}
          {isTrip && event && (
            <TabsContent value="schedule">
              <ScheduleTab
                eventId={eventId}
                event={event}
                members={memberList}
                onConvert={(item) => {
                  setPaymentPrefill({
                    amount: item.cost != null ? Math.round(item.cost) : undefined,
                    description: item.title,
                    payerId: item.payerId ?? undefined,
                    scheduleItemId: item.id,
                  });
                  setEditingPayment(null);
                  setPaymentDialogOpen(true);
                }}
                onShowPayments={() => setActiveTab("payments")}
              />
            </TabsContent>
          )}

          {/* Settlement Tab（モバイルのみ。デスクトップでは右カラムに常時表示） */}
          {!isDesktop && (
            <TabsContent value="settlement">
              <SettlementSection
                isLoading={settlementQuery.isLoading}
                event={event}
                memberList={memberList}
                paymentCount={paymentList.length}
                totalSpent={totalSpent}
                perPersonAvg={perPersonAvg}
                maxAbsBalance={maxAbsBalance}
                settlement={settlement}
                settlementRef={settlementRef}
                exportingImage={exportingImage}
                onCopySummary={handleCopySummary}
                onDownloadCsv={handleDownloadCsv}
                onDownloadImage={handleDownloadImage}
                settlePending={settleMutation.isPending}
                onSettleClick={() => setSettleConfirmOpen(true)}
              />
            </TabsContent>
          )}
        </Tabs>

        {/* Desktop: 精算パネル（右カラム・スクロール追従） */}
        {isDesktop && (
          <aside className="sticky top-[84px] min-w-0">
            <p className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
              Settlement — 精算
            </p>
            <SettlementSection
              isLoading={settlementQuery.isLoading}
              event={event}
              memberList={memberList}
              paymentCount={paymentList.length}
              totalSpent={totalSpent}
              perPersonAvg={perPersonAvg}
              maxAbsBalance={maxAbsBalance}
              settlement={settlement}
              settlementRef={settlementRef}
              exportingImage={exportingImage}
              onCopySummary={handleCopySummary}
              onDownloadCsv={handleDownloadCsv}
              onDownloadImage={handleDownloadImage}
              settlePending={settleMutation.isPending}
              onSettleClick={() => setSettleConfirmOpen(true)}
            />
          </aside>
        )}
        </div>
      </main>

      {/* Mobile: リストが長くなっても親指で届く追加ボタン */}
      {!isDesktop && !event?.isSettled && activeTab === "payments" && sortedPayments.length >= 4 && (
        <Button
          size="icon"
          onClick={() => { setEditingPayment(null); setPaymentDialogOpen(true); }}
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-30 h-14 w-14 rounded-full shadow-glow-lg"
          data-testid="button-add-payment-fab"
          aria-label="支払いを追加"
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Dialogs */}
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={(v) => {
          setPaymentDialogOpen(v);
          if (!v) {
            setEditingPayment(null);
            setPaymentPrefill(null);
          }
        }}
        eventId={eventId}
        members={memberList}
        payment={editingPayment}
        prefill={paymentPrefill}
      />
      <AddMemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} eventId={eventId} />
      {event && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} event={event} />}
      {event && <EventSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} event={event} />}

      <AlertDialog open={settleConfirmOpen} onOpenChange={setSettleConfirmOpen}>
        <AlertDialogContent data-testid="dialog-settle-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>このイベントを精算済みにしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              精算済みにすると、支払いの追加・編集・削除やメンバーの追加ができなくなります。送金が完了してから実行してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-settle">キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { settleMutation.mutate(); setSettleConfirmOpen(false); }}
              data-testid="button-confirm-settle"
            >
              精算する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
