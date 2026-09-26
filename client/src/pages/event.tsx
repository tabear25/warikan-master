import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { toPng } from "html-to-image";
import { AnimatePresence, motion } from "framer-motion";
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
import { Badge, badgeVariants } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { MemberAvatar } from "@/components/member-avatar";
import { ScheduleTab } from "@/components/schedule-tab";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_ICON, EVENT_TYPE_LABEL, formatShortDate } from "@/lib/schedule";
import {
  Plus, PlusCircle, Trash2, Users, Receipt, ArrowRight, CheckCircle2,
  Wallet, Pencil, Share2, Copy, Check, UserPlus, FileDown, Image as ImageIcon, ClipboardCopy,
  Scale, Coins, SplitSquareHorizontal, KeyRound, CalendarDays, RotateCcw, Landmark, Smartphone,
  Banknote, ChevronDown, ListChecks,
} from "lucide-react";
import type { Event, EventType, Member, Payment, PayoutPreference, ScheduleItem, SplitMode } from "@shared/schema";
import { EVENT_TYPES, MAX_SPLIT_WEIGHT, PAYOUT_PREFERENCES, PAYOUT_PREFERENCE_LABELS } from "@shared/schema";
import { computeShares, splitYen } from "@shared/split";
import {
  calculateSettlement,
  type PartialSettlementSummary,
  type SettlementResult,
  type SettlementWithPartials,
  type Transfer,
} from "@shared/settlement";
import { formatYen, formatSignedYen } from "@/lib/currency";
import { CountUp } from "@/components/count-up";
import { fireConfetti } from "@/lib/confetti";
import {
  buildPartialSettlementText,
  buildSettlementCsv,
  buildSettlementText,
  copyToClipboard,
  downloadTextFile,
  triggerDownload,
  safeFileName,
  type PartialSettlementExport,
} from "@/lib/export";

import { SPRING, SPRING_SLOW, fadeUp, stagger } from "@/lib/motion";

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
        partialSettlementId: payment?.partialSettlementId ?? null,
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
                        max={MAX_SPLIT_WEIGHT}
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
        { id: -Date.now(), eventId, name: memberName, payoutPreference: null },
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
// 受け取り方の希望ダイアログ
// 保持するのは手段の種別だけで、口座番号や PayPay ID は保存しない。合言葉を
// 知っている人は全員この値を読めるため、漏れて困るものを置かない方針。
// ---------------------------------------------------------------------------
function PayoutPreferenceDialog({
  member,
  onOpenChange,
  onSelect,
}: {
  member: Member | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (preference: PayoutPreference | null) => void;
}) {
  const current = (member?.payoutPreference ?? null) as PayoutPreference | null;

  return (
    <ResponsiveDialog
      open={member !== null}
      onOpenChange={onOpenChange}
      title={member ? `${member.name}の受け取り方` : "受け取り方"}
      description="送る人が迷わないように希望を選んでおけます。口座番号やIDは保存されません"
    >
      <div className="space-y-2 pt-1">
        {PAYOUT_PREFERENCES.map((preference) => {
          const Icon = PAYOUT_PREFERENCE_ICON[preference];
          const selected = current === preference;
          return (
            <button
              key={preference}
              type="button"
              onClick={() => onSelect(preference)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-200",
                selected ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50",
              )}
              data-testid={`button-payout-${preference}`}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  selected ? "bg-primary/15 text-primary" : "bg-accent text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-foreground">
                {PAYOUT_PREFERENCE_LABELS[preference]}
              </span>
              {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
            </button>
          );
        })}
        {current && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onSelect(null)}
            data-testid="button-payout-clear"
          >
            未設定に戻す
          </Button>
        )}
      </div>
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
// 部分精算ダイアログ（例: 3か月先の旅行で、ホテル代と飛行機代だけ先に精算する）
// 選んだ支払いだけで送金リストを作る。プレビューはサーバと同じ calculateSettlement
// で計算するので、確定後に表示される送金額と一致する。
// ---------------------------------------------------------------------------
function PartialSettlementDialog({
  open,
  onOpenChange,
  event,
  members,
  payments,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: Event;
  members: Member[];
  /** まだどの区切りにも含まれていない支払い */
  payments: Payment[];
  pending: boolean;
  onSubmit: (paymentIds: number[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  useEffect(() => {
    if (open) setSelectedIds([]);
  }, [open]);

  // 楽観追加中の支払い（負の仮 ID）はサーバにまだ無いので選ばせない。
  const selectable = useMemo(
    () => payments.filter((payment) => payment.id > 0).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [payments],
  );

  // 旅程から割り勘に追加した宿泊・移動の支払いを、まとめて選べるようにする
  // （「ホテル代と飛行機代だけ先に」の近道）。旅行イベントのときだけ取得する。
  // ScheduleTab と同じクエリキーなので、旅程タブを開いていればキャッシュが使われる。
  const isTrip = event.type === "trip";
  const scheduleQuery = useQuery<ScheduleItem[]>({
    queryKey: ["/api/events", event.id, "schedule"],
    queryFn: async () => (await apiRequest("GET", `/api/events/${event.id}/schedule`)).json(),
    enabled: open && isTrip,
  });
  const lodgingAndTransportIds = useMemo(() => {
    const itemIds = new Set(
      (scheduleQuery.data ?? [])
        .filter((item) => item.category === "accommodation" || item.category === "transport")
        .map((item) => item.id),
    );
    return selectable
      .filter((payment) => payment.scheduleItemId != null && itemIds.has(payment.scheduleItemId))
      .map((payment) => payment.id);
  }, [scheduleQuery.data, selectable]);

  const selected = selectable.filter((payment) => selectedIds.includes(payment.id));
  const selectedTotal = selected.reduce((acc, payment) => acc + Math.round(payment.amount), 0);
  let preview: SettlementResult | null = null;
  try {
    preview = selected.length > 0 ? calculateSettlement(members, selected) : null;
  } catch {
    // 内訳の JSON が壊れた支払いがあっても、ダイアログ自体は開けるようにする。
    preview = null;
  }

  const allSelected = selectable.length > 0 && selected.length === selectable.length;
  const toggle = (paymentId: number) =>
    setSelectedIds((prev) => (prev.includes(paymentId) ? prev.filter((id) => id !== paymentId) : [...prev, paymentId]));
  const getMemberName = (memberId: number) => members.find((m) => m.id === memberId)?.name ?? "不明";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="一部だけ先に精算"
      description="選んだ支払いだけで送金リストを作ります。残りの支払いは、あとでまとめて精算できます"
      testId="dialog-partial-settlement"
    >
      <div className="space-y-4 pt-1">
        {selectable.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">先に精算できる支払いがありません</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {lodgingAndTransportIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedIds((prev) => Array.from(new Set(prev.concat(lodgingAndTransportIds))))}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary transition-colors duration-200 hover:bg-primary/10"
                  data-testid="button-select-lodging-transport"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  宿泊・移動をまとめて選ぶ
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setSelectedIds(allSelected ? [] : selectable.map((payment) => payment.id))}
                className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
                data-testid="button-toggle-all-partial"
              >
                {allSelected ? "全部はずす" : "全部選ぶ"}
              </button>
            </div>

            <div className="space-y-1">
              {selectable.map((payment) => {
                const checked = selectedIds.includes(payment.id);
                const payerName = getMemberName(payment.payerId);
                return (
                  <div
                    key={payment.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-150",
                      checked && "bg-accent/60",
                    )}
                  >
                    <Checkbox
                      id={`partial-payment-${payment.id}`}
                      checked={checked}
                      onCheckedChange={() => toggle(payment.id)}
                      data-testid={`checkbox-partial-payment-${payment.id}`}
                    />
                    <MemberAvatar name={payerName} className="h-6 w-6 text-[10px]" />
                    <label htmlFor={`partial-payment-${payment.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="flex items-center gap-1">
                        <span className="truncate text-sm font-medium text-foreground">{payment.description}</span>
                        {payment.scheduleItemId != null && (
                          <CalendarDays className="h-3 w-3 shrink-0 text-primary" aria-label="旅程から追加した支払い" />
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">{payerName} が支払い</span>
                    </label>
                    <span className="money shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatYen(payment.amount)}</span>
                  </div>
                );
              })}
            </div>

            {preview && (
              <div className="space-y-2 rounded-2xl bg-accent/50 p-3" data-testid="partial-settlement-preview">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-semibold text-foreground">この内容で精算すると</span>
                  <span className="text-muted-foreground">
                    {selected.length}件 · 合計{" "}
                    <span className="money font-bold tabular-nums text-foreground">{formatYen(selectedTotal)}</span>
                  </span>
                </div>
                {preview.transfers.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">送金は不要です（選んだ支払いの中で収支が釣り合っています）</p>
                ) : (
                  <ul className="space-y-1.5">
                    {preview.transfers.map((t, i) => (
                      <li key={i} className="flex items-center gap-1.5 text-xs" data-testid={`partial-preview-transfer-${i}`}>
                        <MemberAvatar name={t.from} className="h-5 w-5 text-[9px]" />
                        <span className="min-w-0 truncate font-medium text-foreground">{t.from}</span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                        <MemberAvatar name={t.to} className="h-5 w-5 text-[9px]" />
                        <span className="min-w-0 truncate font-medium text-foreground">{t.to}</span>
                        <span className="money ml-auto shrink-0 font-bold tabular-nums text-positive">{formatYen(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              選んだ支払いは「先に精算済み」になり、取り消すまで編集・削除できなくなります。
            </p>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={pending || selected.length === 0}
              onClick={() => onSubmit(selected.map((payment) => payment.id))}
              data-testid="button-submit-partial-settlement"
            >
              {pending ? "精算中..." : selected.length > 0 ? `${selected.length}件を先に精算する` : "支払いを選んでください"}
            </Button>
          </>
        )}
      </div>
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
        <CountUp
          value={balance}
          render={formatSignedYen}
          className={cn("money font-bold tabular-nums", positive ? "text-positive" : "text-negative")}
        />
      </div>
      <div className="relative flex h-2.5 overflow-hidden rounded-full bg-muted">
        <div className="flex w-1/2 justify-end">
          {!positive && (
            <motion.div
              className="h-full rounded-l-full bg-gradient-to-l from-negative/60 to-negative"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={SPRING_SLOW}
            />
          )}
        </div>
        <div className="flex w-1/2 justify-start">
          {positive && (
            <motion.div
              className="h-full rounded-r-full bg-gradient-to-r from-positive/60 to-positive"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={SPRING_SLOW}
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
// GET /api/events/:id/settlement の形。transfers / balances は残り（未精算分）で、
// 先に精算した分（部分精算）は partialSettlements に区切りごとに入る。
type SettlementData = SettlementWithPartials;

// 受け取り方の希望に添えるアイコン。ラベルの正本は @shared/schema の
// PAYOUT_PREFERENCE_LABELS 側で、ここは見た目だけを持つ。
const PAYOUT_PREFERENCE_ICON: Record<PayoutPreference, typeof Landmark> = {
  bank: Landmark,
  paypay: Smartphone,
  cash: Banknote,
  any: Coins,
};

// 送金行を開いたときに見せる、メンバー1人分の内訳。
// 立替合計 − 負担合計 = その人の収支（settlement.balances と一致する）。
interface BreakdownRow {
  paymentId: number;
  description: string;
  paid: number;  // この人が立て替えた額（0 なら立替なし）
  share: number; // この人の負担額（0 なら割り勘対象外）
}

interface MemberBreakdown {
  paidTotal: number;
  shareTotal: number;
  rows: BreakdownRow[];
}

// 支払いをメンバー別に組み直し、「なぜこの金額？」に答えられる形にする。
// 割り勘の配分はサーバの精算と同じ computeShares を使うので、ここの合計は
// 同じ支払いから計算した balances と必ず一致する。
function buildBreakdownByName(memberList: Member[], payments: Payment[]): Map<string, MemberBreakdown> {
  const byId = new Map<number, MemberBreakdown>();
  memberList.forEach((m) => byId.set(m.id, { paidTotal: 0, shareTotal: 0, rows: [] }));

  const ordered = [...payments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const payment of ordered) {
    let shares: Map<number, number>;
    try {
      shares = computeShares(payment);
    } catch {
      // splitMemberIds / splitDetails は JSON 文字列。壊れていても詳細が
      // 開けなくなるだけで済むよう、その1件を飛ばす。
      continue;
    }
    const total = Math.round(payment.amount);
    // スプレッドは tsconfig の target だと Map の iterator を展開できないので forEach で集める。
    const involved = new Set<number>([payment.payerId]);
    shares.forEach((_, memberId) => involved.add(memberId));
    involved.forEach((memberId) => {
      const entry = byId.get(memberId);
      if (!entry) return; // 削除済みメンバーは収支にも現れないので無視
      const paid = payment.payerId === memberId ? total : 0;
      const share = shares.get(memberId) ?? 0;
      if (paid === 0 && share === 0) return; // 重み 0 の参加者は行を作らない
      entry.paidTotal += paid;
      entry.shareTotal += share;
      entry.rows.push({ paymentId: payment.id, description: payment.description, paid, share });
    });
  }

  // transfers は相手を名前で指す。メンバー名はイベント内で重複禁止
  // （POST /api/events/:id/members が 409 を返す）なので、名前をキーにして衝突しない。
  return new Map(
    memberList.map((m) => [m.name, byId.get(m.id) as MemberBreakdown]),
  );
}

// 送金リストの行。タップすると、送る人の収支（立替合計 − 負担合計）と支払いごとの
// 内訳を開く（アコーディオンと同じく同時に1つだけ）。残りの精算と、先に精算した
// 区切りの両方で使う。
function TransferList({
  transfers,
  memberList,
  payments,
  testIdPrefix = "",
}: {
  transfers: Transfer[];
  memberList: Member[];
  /** この送金リストの元になった支払い（内訳の計算に使う） */
  payments: Payment[];
  /** 複数のリストを並べたときに testid / id が衝突しないようにする接頭辞 */
  testIdPrefix?: string;
}) {
  const payoutPreferenceByName = new Map(
    memberList.map((m) => [m.name, (m.payoutPreference ?? null) as PayoutPreference | null]),
  );
  const [openTransfer, setOpenTransfer] = useState<number | null>(null);
  const breakdownByName = useMemo(() => buildBreakdownByName(memberList, payments), [memberList, payments]);

  return (
    <>
      {transfers.map((t, i) => {
        const preference = payoutPreferenceByName.get(t.to) ?? null;
        const detail = breakdownByName.get(t.from) ?? null;
        const balance = detail ? detail.paidTotal - detail.shareTotal : 0;
        const isOpen = openTransfer === i;
        const detailId = `${testIdPrefix}transfer-detail-${i}`;
        return (
          <div key={i} className="overflow-hidden rounded-xl bg-accent/50" data-testid={`${testIdPrefix}transfer-${i}`}>
            <button
              type="button"
              onClick={() => setOpenTransfer(isOpen ? null : i)}
              aria-expanded={isOpen}
              aria-controls={detailId}
              className="w-full p-2.5 text-left transition-colors duration-200 hover:bg-accent/80"
              data-testid={`${testIdPrefix}button-transfer-${i}`}
            >
              <div className="flex items-center gap-2">
                <MemberAvatar name={t.from} className="h-7 w-7 text-[10px]" />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.from}</span>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
                <MemberAvatar name={t.to} className="h-7 w-7 text-[10px]" />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.to}</span>
                <span className="money ml-auto shrink-0 text-sm font-bold tabular-nums text-positive">{formatYen(t.amount)}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </div>
              {preference && (
                <p
                  className="mt-1.5 pl-9 text-[11px] text-muted-foreground"
                  data-testid={`${testIdPrefix}transfer-payout-${i}`}
                >
                  受け取り方: {PAYOUT_PREFERENCE_LABELS[preference]}
                </p>
              )}
            </button>

            <AnimatePresence initial={false}>
              {isOpen && detail && (
                <motion.div
                  id={detailId}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                  data-testid={detailId}
                >
                  <div className="space-y-3 border-t border-border/60 px-2.5 pb-3 pt-2.5">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold text-foreground">{t.from}の収支</p>
                      <dl className="space-y-0.5 text-[11px]">
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">立て替えた合計</dt>
                          <dd className="money tabular-nums text-foreground">{formatYen(detail.paidTotal)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2">
                          <dt className="text-muted-foreground">割り勘の負担</dt>
                          <dd className="money tabular-nums text-foreground">{formatYen(detail.shareTotal)}</dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-2 border-t border-border/60 pt-1 font-semibold">
                          <dt className="text-muted-foreground">差引</dt>
                          <dd className={cn("money tabular-nums", balance >= 0 ? "text-positive" : "text-negative")}>
                            {formatSignedYen(balance)}
                          </dd>
                        </div>
                      </dl>
                      {/* 貪欲法では1人の不足が複数の送金に分かれる。差引と送金額が
                          合わないときだけ、その理由を書き足す。 */}
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {balance < 0 && -balance !== t.amount
                          ? `不足している${formatYen(-balance)}のうち、${formatYen(t.amount)}を${t.to}さんへ（残りはほかの人へ）`
                          : `この不足分を${t.to}さんへ送ると精算完了です`}
                      </p>
                    </div>

                    {detail.rows.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold text-foreground">
                          支払いごとの内訳（{detail.rows.length}件）
                        </p>
                        <div className="space-y-0.5">
                          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-x-2 text-[10px] font-semibold text-muted-foreground">
                            <span>内容</span>
                            <span className="text-right">立替</span>
                            <span className="text-right">負担</span>
                          </div>
                          {detail.rows.map((row) => (
                            <div
                              key={row.paymentId}
                              className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-x-2 text-[11px]"
                              data-testid={`${testIdPrefix}transfer-detail-row-${row.paymentId}`}
                            >
                              <span className="truncate text-foreground">{row.description}</span>
                              <span className="money text-right tabular-nums text-muted-foreground">
                                {row.paid > 0 ? formatYen(row.paid) : "—"}
                              </span>
                              <span className="money text-right tabular-nums text-foreground">
                                {row.share > 0 ? formatYen(row.share) : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </>
  );
}

// 部分精算の作成日時（ISO 文字列）を「9/26（土）14:05」の形にする。端末のローカル時刻で数える。
// 時刻まで出すのは、同じ日に2回精算したときに区切り（CSV のセクション名など）を見分けるため。
function formatSettledOn(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = formatShortDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
  return `${day}${date.getHours()}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 先に精算した分（部分精算の履歴）
// ---------------------------------------------------------------------------
function PartialSettlementHistory({
  partials,
  memberList,
  paymentsById,
  canUndo,
  undoPending,
  onCopy,
  onUndo,
}: {
  partials: PartialSettlementSummary[];
  memberList: Member[];
  paymentsById: Map<number, Payment>;
  canUndo: boolean;
  undoPending: boolean;
  onCopy: (partial: PartialSettlementSummary) => void;
  onUndo: (partial: PartialSettlementSummary) => void;
}) {
  return (
    <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.18 }}>
      <Card data-testid="card-partial-settlements">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-bold">先に精算した分</CardTitle>
          <CardDescription className="text-xs">ここに含めた支払いは、上の精算から除いています</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-4">
          {partials.map((partial, index) => {
            const included = partial.paymentIds
              .map((paymentId) => paymentsById.get(paymentId))
              .filter((payment): payment is Payment => payment !== undefined);
            return (
              <div
                key={partial.id}
                className={cn("space-y-2", index > 0 && "border-t border-border/60 pt-4")}
                data-testid={`partial-settlement-${partial.id}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">
                    {formatSettledOn(partial.createdAt)}に精算 · {partial.paymentIds.length}件
                  </p>
                  <span className="money shrink-0 text-sm font-bold tabular-nums text-foreground">{formatYen(partial.total)}</span>
                </div>
                {included.length > 0 && (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {included.map((payment) => payment.description).join("、")}
                  </p>
                )}
                {partial.transfers.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">この分の送金は不要です（収支が釣り合っています）</p>
                ) : (
                  <div className="space-y-2">
                    <TransferList
                      transfers={partial.transfers}
                      memberList={memberList}
                      payments={included}
                      testIdPrefix={`partial-${partial.id}-`}
                    />
                  </div>
                )}
                {/* 画像の書き出しには操作ボタンを写さない（handleDownloadImage の filter） */}
                <div className="flex justify-end gap-1" data-export-exclude="true">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCopy(partial)}
                    data-testid={`button-copy-partial-${partial.id}`}
                  >
                    <ClipboardCopy className="h-3.5 w-3.5" /> コピー
                  </Button>
                  {canUndo && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => onUndo(partial)}
                      disabled={undoPending}
                      data-testid={`button-undo-partial-${partial.id}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 取り消す
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface SettlementSectionProps {
  isLoading: boolean;
  event: Event | undefined;
  memberList: Member[];
  payments: Payment[];
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
  unsettlePending: boolean;
  onUnsettleClick: () => void;
  onPartialSettleClick: () => void;
  onCopyPartial: (partial: PartialSettlementSummary) => void;
  undoPartialPending: boolean;
  onUndoPartialClick: (partial: PartialSettlementSummary) => void;
}

function SettlementSection({
  isLoading,
  event,
  memberList,
  payments,
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
  unsettlePending,
  onUnsettleClick,
  onPartialSettleClick,
  onCopyPartial,
  undoPartialPending,
  onUndoPartialClick,
}: SettlementSectionProps) {
  // transfers は名前文字列で相手を指すので、受け取り方の希望も名前で引く。
  // メンバー名はイベント内で重複禁止（POST /api/events/:id/members が 409 を返す）
  // なので、名前をキーにして衝突しない。
  const payoutPreferenceByName = new Map(
    memberList.map((m) => [m.name, (m.payoutPreference ?? null) as PayoutPreference | null]),
  );

  // 先に精算した分（部分精算）と、残り（どの区切りにも含まれない支払い）。
  // サーバと同じく「区切りが持つ支払い ID」で分けるので、残りの内訳は
  // settlement.balances と必ず一致する。
  const partials = useMemo(() => settlement?.partialSettlements ?? [], [settlement]);
  const hasPartials = partials.length > 0;
  const { remainingPayments, paymentsById } = useMemo(() => {
    const settledIds = new Set<number>();
    partials.forEach((partial) => partial.paymentIds.forEach((paymentId) => settledIds.add(paymentId)));
    return {
      remainingPayments: payments.filter((payment) => !settledIds.has(payment.id)),
      paymentsById: new Map(payments.map((payment) => [payment.id, payment])),
    };
  }, [payments, partials]);

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
      <motion.div {...fadeUp} transition={SPRING} className="space-y-4">
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
              <Wallet className="h-7 w-7" />
            </div>
            <p className="mb-1 text-sm font-semibold text-foreground">支払いを追加してください</p>
            <p className="text-xs text-muted-foreground">支払いを記録すると精算結果が表示されます</p>
          </CardContent>
        </Card>
        {/* 支払いの取得に失敗すると paymentCount は 0 になる。精算済みのまま
            取り消しボタンまで消えると、誤タップした人の復旧手段が無くなるので
            この空状態でも出しておく。 */}
        {event?.isSettled && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onUnsettleClick}
            disabled={unsettlePending}
            data-testid="button-unsettle-empty"
          >
            <RotateCcw className="h-4 w-4" />
            {unsettlePending ? "取り消し中..." : "精算を取り消す"}
          </Button>
        )}
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
          transition={SPRING}
        >
          <Card className="border-transparent bg-primary text-primary-foreground shadow-md">
            <CardContent className="p-3 text-center">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">総支出</p>
              <p className="money text-sm font-bold tabular-nums"><CountUp value={totalSpent} render={formatYen} /></p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">件数</p>
              <p className="money text-sm font-bold tabular-nums text-foreground"><CountUp value={paymentCount} /></p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">1人平均</p>
              <p className="money text-sm font-bold tabular-nums text-foreground"><CountUp value={perPersonAvg} render={formatYen} /></p>
            </CardContent>
          </Card>
        </motion.div>

        {remainingPayments.length === 0 ? (
          // 支払いがすべて先に精算済み（例: 旅行前にホテル代と飛行機代だけ精算した直後）。
          // 残りの収支はすべて 0 なので、収支バーと送金リストの代わりにこれだけを出す。
          <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.06 }}>
            <Card data-testid="card-no-remaining">
              <CardContent className="py-6 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-positive/15 text-positive">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-foreground">未精算の支払いはありません</p>
                <p className="text-xs text-muted-foreground">
                  {event?.isSettled
                    ? "すべての支払いを先に精算しています"
                    : "これから追加する支払いは、ここでまとめて精算できます"}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <>
            {/* Balance bars */}
            {settlement && memberList.length > 0 && (
              <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.06 }}>
                <Card>
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm font-bold">各自の収支</CardTitle>
                    <CardDescription className="text-xs">
                      {hasPartials
                        ? "先に精算した分を除いた収支です。プラスは受け取り、マイナスは支払い"
                        : "プラスは受け取り、マイナスは支払い"}
                    </CardDescription>
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
              <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.12 }}>
                <Card className="border-positive/20 bg-positive/5">
                  <CardContent className="py-6 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-positive/15 text-positive">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">{hasPartials ? "残りの精算は不要です" : "精算不要！"}</p>
                    <p className="text-xs text-muted-foreground">
                      {hasPartials
                        ? "先に精算した分を除くと、全員の収支は釣り合っています"
                        : "全員の収支はすでにバランスが取れています"}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.12 }}>
                <Card>
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm font-bold">{hasPartials ? "残りの送金リスト" : "送金リスト"}</CardTitle>
                    <CardDescription className="text-xs">最小の回数で精算できます</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 pb-4">
                    {settlement && (
                      <TransferList transfers={settlement.transfers} memberList={memberList} payments={remainingPayments} />
                    )}
                    {/* 送金リストを見て「どう払えば？」となる場面なので、未設定のときだけ入口を案内する */}
                    {settlement && settlement.transfers.length > 0 &&
                      !settlement.transfers.some((t) => payoutPreferenceByName.get(t.to)) && (
                      <p
                        className="pt-1 text-[11px] leading-relaxed text-muted-foreground"
                        data-testid="text-settlement-payout-hint"
                      >
                        受け取り方（銀行振込・PayPayなど）は、メンバー名をタップすると登録できます（精算後も変更できます）
                      </p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </>
        )}

        {/* 先に精算した分（部分精算の履歴） */}
        {hasPartials && (
          <PartialSettlementHistory
            partials={partials}
            memberList={memberList}
            paymentsById={paymentsById}
            canUndo={!event?.isSettled}
            undoPending={undoPartialPending}
            onCopy={onCopyPartial}
            onUndo={onUndoPartialClick}
          />
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

      {/* 一部だけ先に精算（例: 旅行の数か月前に、ホテル代と飛行機代だけ）。
          イベント全体はロックしないので、そのあとも支払いを追加できる。 */}
      {!event?.isSettled && remainingPayments.length > 0 && (
        <div className="space-y-1.5">
          <Button
            variant="outline"
            className="w-full"
            onClick={onPartialSettleClick}
            data-testid="button-partial-settle"
          >
            <ListChecks className="h-4 w-4" />
            一部だけ先に精算
          </Button>
          {!hasPartials && (
            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              ホテル代・飛行機代など、選んだ支払いだけを先に精算できます
            </p>
          )}
        </div>
      )}

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
          <CardContent className="space-y-3 py-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-positive/15 text-positive">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">精算済み</p>
                <p className="text-xs text-muted-foreground">このイベントは精算が完了しています</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={onUnsettleClick}
              disabled={unsettlePending}
              data-testid="button-unsettle"
            >
              <RotateCcw className="h-4 w-4" />
              {unsettlePending ? "取り消し中..." : "精算を取り消す"}
            </Button>
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
  const [unsettleConfirmOpen, setUnsettleConfirmOpen] = useState(false);
  const [partialDialogOpen, setPartialDialogOpen] = useState(false);
  const [partialToUndo, setPartialToUndo] = useState<PartialSettlementSummary | null>(null);
  const [payoutTarget, setPayoutTarget] = useState<Member | null>(null);
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

  // 支払いと精算結果は、画面に戻ったとき（LINE などから切り替えたとき）に取り直す。
  // 誰かが部分精算したあとも古い送金リストを出し続けると、先に精算した分をもう一度
  // 送る（二重払い）きっかけになるため。既定の staleTime: Infinity のもとでは
  // true では取り直されないので "always" にする。
  const paymentsQuery = useQuery<Payment[]>({
    queryKey: ["/api/events", eventId, "payments"],
    queryFn: async () => (await apiRequest("GET", `/api/events/${eventId}/payments`)).json(),
    enabled: !isNaN(eventId) && eventId > 0,
    refetchOnWindowFocus: "always",
  });

  const settlementQuery = useQuery<SettlementData>({
    queryKey: ["/api/events", eventId, "settlement"],
    queryFn: async () => (await apiRequest("GET", `/api/events/${eventId}/settlement`)).json(),
    enabled: !isNaN(eventId) && eventId > 0,
    refetchOnWindowFocus: "always",
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
      fireConfetti();
      toast({ title: "精算が完了しました🎉", description: "おつかれさまでした。このイベントは精算済みになりました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  const unsettleMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/events/${eventId}/unsettle`)).json(),
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId] });
      toast({ title: "精算を取り消しました", description: "支払いの追加・編集ができる状態に戻りました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  // 部分精算は金額に直結する操作なので楽観更新はせず、サーバの結果を待ってから閉じる。
  // 支払い側（partialSettlementId）と精算結果の両方が変わるので、両方を取り直す。
  const refreshAfterPartialChange = () => {
    queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "payments"] });
    queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
  };

  const partialSettleMutation = useMutation({
    mutationFn: async (paymentIds: number[]): Promise<PartialSettlementSummary> =>
      (await apiRequest("POST", `/api/events/${eventId}/partial-settlements`, { paymentIds })).json(),
    onSuccess: (partial) => {
      setPartialDialogOpen(false);
      toast({
        title: `${partial.paymentIds.length}件の支払いを先に精算しました`,
        description: "送金リストは「先に精算した分」に残ります",
      });
    },
    onError: (err: Error) => {
      toast({ title: "精算できませんでした", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
    onSettled: refreshAfterPartialChange,
  });

  const undoPartialMutation = useMutation({
    mutationFn: async (partialId: number) => {
      await apiRequest("DELETE", `/api/events/${eventId}/partial-settlements/${partialId}`);
    },
    onSuccess: () => {
      toast({ title: "先に精算した分を取り消しました", description: "含めていた支払いは未精算に戻りました" });
    },
    onError: (err: Error) => {
      toast({ title: "取り消せませんでした", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
    onSettled: refreshAfterPartialChange,
  });

  // 楽観更新：選んだ瞬間にチップと送金リストへ反映し、失敗した場合のみ巻き戻す。
  // 本番の DB は Turso（リモート）なので、往復を待つと「押したのに変わらない」時間ができる。
  const payoutMutation = useMutation({
    mutationFn: async ({ memberId, payoutPreference }: { memberId: number; payoutPreference: PayoutPreference | null }) =>
      (await apiRequest("PATCH", `/api/events/${eventId}/members/${memberId}`, { payoutPreference })).json(),
    onMutate: async ({ memberId, payoutPreference }) => {
      const membersKey = ["/api/events", eventId, "members"];
      await queryClientHook.cancelQueries({ queryKey: membersKey });
      const prev = queryClientHook.getQueryData<Member[]>(membersKey);
      queryClientHook.setQueryData<Member[]>(membersKey, (old = []) =>
        old.map((m) => (m.id === memberId ? { ...m, payoutPreference } : m)),
      );
      return { prev };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prev) queryClientHook.setQueryData(["/api/events", eventId, "members"], ctx.prev);
      toast({
        title: "保存できませんでした（元に戻しました）",
        description: err.message.replace(/^\d+: /, ""),
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "members"] });
    },
  });

  const event = eventQuery.data;
  const memberList = membersQuery.data ?? [];
  const paymentList = paymentsQuery.data ?? [];
  const settlement = settlementQuery.data;

  // 受け取り方は名前をタップしないと気づけないので、まだ誰も設定していない間だけ
  // メンバーバーの下に案内を出す（誰かが設定したら自然に消える）。
  const showPayoutHint = memberList.length > 0 && memberList.every((m) => !m.payoutPreference);

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
  // 先に精算した支払い（部分精算に含まれる支払い）と、まだの支払い。
  const settledEarlyCount = useMemo(
    () => paymentList.filter((p) => p.partialSettlementId != null).length,
    [paymentList],
  );
  const unsettledPayments = useMemo(
    () => paymentList.filter((p) => p.partialSettlementId == null),
    [paymentList],
  );
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

  const exportMembers = memberList.map((m) => ({
    id: m.id,
    name: m.name,
    payoutLabel: m.payoutPreference
      ? PAYOUT_PREFERENCE_LABELS[m.payoutPreference as PayoutPreference]
      : null,
  }));

  // 先に精算した区切りを、書き出し用の形（日付ラベルと、含まれる支払いの内容・金額）にする。
  const toPartialExport = (partial: PartialSettlementSummary): PartialSettlementExport => ({
    label: formatSettledOn(partial.createdAt),
    payments: partial.paymentIds
      .map((paymentId) => paymentList.find((payment) => payment.id === paymentId))
      .filter((payment): payment is Payment => payment !== undefined)
      .map((payment) => ({ description: payment.description, amount: Math.round(payment.amount) })),
    total: partial.total,
    transfers: partial.transfers,
  });

  const exportData = event && settlement
    ? {
        eventName: event.name,
        members: exportMembers,
        balances: settlement.balances,
        transfers: settlement.transfers,
        partials: (settlement.partialSettlements ?? []).map(toPartialExport),
      }
    : null;

  const handleCopySummary = async () => {
    if (!exportData) return;
    const ok = await copyToClipboard(buildSettlementText(exportData));
    toast({ title: ok ? "精算結果をコピーしました" : "コピーに失敗しました", variant: ok ? undefined : "destructive" });
  };

  // 先に精算した分だけを、グループに「この分を送ってください」と貼る用にコピーする。
  const handleCopyPartial = async (partial: PartialSettlementSummary) => {
    if (!event) return;
    const ok = await copyToClipboard(buildPartialSettlementText(event.name, exportMembers, toPartialExport(partial)));
    toast({ title: ok ? "先に精算する分をコピーしました" : "コピーに失敗しました", variant: ok ? undefined : "destructive" });
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
      const dataUrl = await toPng(settlementRef.current, {
        backgroundColor: bg,
        pixelRatio: 2,
        // 部分精算の「コピー／取り消す」など、操作ボタンは画像に写さない。
        // filter にはテキストノードも渡ってくるので、要素かどうかを先に確かめる。
        filter: (node) => !(node instanceof HTMLElement && node.dataset.exportExclude === "true"),
      });
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
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              {memberList.map((m) => {
                const preference = (m.payoutPreference ?? null) as PayoutPreference | null;
                const PreferenceIcon = preference ? PAYOUT_PREFERENCE_ICON[preference] : null;
                // 楽観追加中のメンバーは負の仮 ID を持つ（AddMemberDialog の onMutate）。
                // サーバにまだ存在しないので、押しても必ず 404 になる。保存が済むまで無効化する。
                const isSaving = m.id < 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPayoutTarget(m)}
                    disabled={isSaving}
                    className={cn(
                      badgeVariants({ variant: "secondary" }),
                      "gap-1.5 py-0.5 pl-1 pr-2.5",
                      isSaving && "opacity-60",
                    )}
                    data-testid={`badge-member-${m.id}`}
                    aria-label={
                      isSaving
                        ? `${m.name}を保存中`
                        : preference
                          ? `${m.name}の受け取り方（${PAYOUT_PREFERENCE_LABELS[preference]}）を変更`
                          : `${m.name}の受け取り方を設定`
                    }
                  >
                    <MemberAvatar name={m.name} className="h-5 w-5 text-[9px]" />
                    {m.name}
                    {/* 未設定のときも薄い財布アイコンを出し、「押せる」ことを見た目で示す */}
                    {PreferenceIcon ? (
                      <PreferenceIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <Wallet className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />
                    )}
                  </button>
                );
              })}
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
            {showPayoutHint && (
              <p
                className="mt-1.5 flex items-start gap-1 pl-6 text-[11px] leading-relaxed text-muted-foreground"
                data-testid="text-payout-hint"
              >
                <Wallet className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
                <span>
                  メンバー名をタップすると、受け取り方（銀行振込・PayPayなど）の希望を登録できます
                </span>
              </p>
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
              <motion.div {...fadeUp} transition={SPRING}>
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
                <span>
                  支払い {paymentList.length} 件
                  {settledEarlyCount > 0 && `（うち先に精算 ${settledEarlyCount} 件）`}
                </span>
                <span>合計 <CountUp value={totalSpent} render={formatYen} className="money font-bold text-foreground tabular-nums" /></span>
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
              <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.05 }}>
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
                <AnimatePresence>
                {sortedPayments.map((p, index) => {
                  const splitIds: number[] = JSON.parse(p.splitMemberIds);
                  const isAllMembers = splitIds.length === memberList.length;
                  const mode = (p.splitMode ?? "equal") as SplitMode;
                  const payerName = getMemberName(p.payerId);
                  // 先に精算した支払いは、区切りを取り消すまで編集・削除できない（サーバも 400 を返す）。
                  const settledEarly = p.partialSettlementId != null;
                  return (
                    <motion.div
                      key={p.id}
                      layout
                      {...fadeUp}
                      transition={{ ...SPRING, delay: stagger(index, 0.045) }}
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
                              {settledEarly && (
                                <Badge
                                  variant="outline"
                                  className="gap-0.5 border-positive/30 px-1.5 py-0 text-[10px] text-positive"
                                  data-testid={`badge-settled-early-${p.id}`}
                                >
                                  <CheckCircle2 className="h-2.5 w-2.5" />
                                  先に精算済み
                                </Badge>
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
                            {!event?.isSettled && !settledEarly && (
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
                </AnimatePresence>
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
                payments={paymentList}
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
                unsettlePending={unsettleMutation.isPending}
                onUnsettleClick={() => setUnsettleConfirmOpen(true)}
                onPartialSettleClick={() => setPartialDialogOpen(true)}
                onCopyPartial={handleCopyPartial}
                undoPartialPending={undoPartialMutation.isPending}
                onUndoPartialClick={setPartialToUndo}
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
              payments={paymentList}
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
              unsettlePending={unsettleMutation.isPending}
              onUnsettleClick={() => setUnsettleConfirmOpen(true)}
              onPartialSettleClick={() => setPartialDialogOpen(true)}
              onCopyPartial={handleCopyPartial}
              undoPartialPending={undoPartialMutation.isPending}
              onUndoPartialClick={setPartialToUndo}
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
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-30 h-14 w-14 rounded-full shadow-lg"
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
      {event && (
        <PartialSettlementDialog
          open={partialDialogOpen}
          onOpenChange={setPartialDialogOpen}
          event={event}
          members={memberList}
          payments={unsettledPayments}
          pending={partialSettleMutation.isPending}
          onSubmit={(paymentIds) => partialSettleMutation.mutate(paymentIds)}
        />
      )}

      <AlertDialog
        open={partialToUndo !== null}
        onOpenChange={(open) => { if (!open) setPartialToUndo(null); }}
      >
        {partialToUndo && (
          <AlertDialogContent data-testid="dialog-undo-partial">
            <AlertDialogHeader>
              <AlertDialogTitle>先に精算した分を取り消しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                {formatSettledOn(partialToUndo.createdAt)}に精算した{partialToUndo.paymentIds.length}件（{formatYen(partialToUndo.total)}）が
                未精算に戻り、残りの送金リストに合算されます。この分をすでに送金した人がいると、その額も残りの送金リストに入るため、
                二重払いになります。まだ誰も送金していないときだけ取り消してください。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-undo-partial">キャンセル</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  undoPartialMutation.mutate(partialToUndo.id);
                  setPartialToUndo(null);
                }}
                data-testid="button-confirm-undo-partial"
              >
                取り消す
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <AlertDialog open={settleConfirmOpen} onOpenChange={setSettleConfirmOpen}>
        <AlertDialogContent data-testid="dialog-settle-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>このイベントを精算済みにしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              精算済みにすると、支払いの追加・編集・削除やメンバーの追加ができなくなります。送金が完了してから実行してください。
              {isTrip && "旅行前に一部の支払いだけ精算したいときは、「一部だけ先に精算」を使ってください。"}
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

      <AlertDialog open={unsettleConfirmOpen} onOpenChange={setUnsettleConfirmOpen}>
        <AlertDialogContent data-testid="dialog-unsettle-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>精算を取り消しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              支払いの追加・編集・削除やメンバーの追加ができる状態に戻ります。すでに送金が済んでいる人がいる場合は、金額が変わることを伝えてください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-unsettle">キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { unsettleMutation.mutate(); setUnsettleConfirmOpen(false); }}
              data-testid="button-confirm-unsettle"
            >
              取り消す
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PayoutPreferenceDialog
        member={payoutTarget}
        onOpenChange={(open) => { if (!open) setPayoutTarget(null); }}
        onSelect={(payoutPreference) => {
          if (!payoutTarget) return;
          payoutMutation.mutate({ memberId: payoutTarget.id, payoutPreference });
          setPayoutTarget(null);
        }}
      />
    </div>
  );
}
