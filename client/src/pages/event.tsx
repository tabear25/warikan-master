import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { toPng } from "html-to-image";
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import {
  Moon, Sun, ArrowLeft, PlusCircle, Trash2, Users, Receipt, ArrowRight, CheckCircle2,
  Wallet, Pencil, Share2, Copy, Check, UserPlus, FileDown, Image as ImageIcon, ClipboardCopy,
  Scale, Coins, SplitSquareHorizontal,
} from "lucide-react";
import type { Event, Member, Payment, SplitMode } from "@shared/schema";
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

function WaricanLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-label="Warikan Master" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
      <path d="M14 10 L24 24 L34 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 24 L24 38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 28 L30 28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 33 L30 33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="16" cy="12" r="2" fill="currentColor" opacity="0.5" />
      <circle cx="32" cy="12" r="2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

const SPLIT_MODE_LABEL: Record<SplitMode, string> = {
  equal: "均等",
  ratio: "比率",
  amount: "金額指定",
};

// ---------------------------------------------------------------------------
// 支払いの追加 / 編集ダイアログ（割り勘モード対応）
// ---------------------------------------------------------------------------
interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  members: Member[];
  payment?: Payment | null; // 指定時は編集モード
}

function PaymentDialog({ open, onOpenChange, eventId, members, payment }: PaymentDialogProps) {
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
      setPayerId("");
      setAmount("");
      setDescription("");
      setSplitMode("equal");
      setSelectedIds(allIds);
      setWeights(Object.fromEntries(allIds.map((id) => [id, "1"])));
      setAmounts(Object.fromEntries(allIds.map((id) => [id, ""])));
    }
  }, [open, payment, members]);

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const url = isEdit
        ? `/api/events/${eventId}/payments/${payment!.id}`
        : `/api/events/${eventId}/payments`;
      const res = await apiRequest(isEdit ? "PATCH" : "POST", url, data);
      return res.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "payments"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
      toast({ title: isEdit ? "支払いを更新しました" : "支払いを追加しました" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-4 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{isEdit ? "支払いを編集" : "支払いを追加"}</DialogTitle>
          <DialogDescription className="text-sm">誰が何をいくら払ったか記録します</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label className="text-sm">支払った人</Label>
            <Select value={payerId} onValueChange={setPayerId}>
              <SelectTrigger data-testid="select-payer">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)} data-testid={`option-payer-${m.id}`}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2 cursor-pointer text-xs transition-colors ${
                    splitMode === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
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
            <Label className="text-sm">割り勘する人</Label>
            <div className="space-y-1.5">
              {members.map((m) => {
                const checked = selectedIds.includes(m.id);
                const share = preview.get(m.id);
                return (
                  <div key={m.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`split-member-${m.id}`}
                      data-testid={`checkbox-split-member-${m.id}`}
                      checked={checked}
                      onCheckedChange={() => toggleMember(m.id)}
                    />
                    <label htmlFor={`split-member-${m.id}`} className="text-sm cursor-pointer flex-1 truncate">{m.name}</label>
                    {checked && splitMode === "ratio" && (
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        className="h-7 w-16 text-xs"
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
                        className="h-7 w-20 text-xs"
                        placeholder="円"
                        value={amounts[m.id] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        data-testid={`amount-${m.id}`}
                        aria-label={`${m.name} の金額`}
                      />
                    )}
                    {checked && splitMode !== "amount" && share !== undefined && (
                      <span className="text-xs text-muted-foreground w-16 text-right tabular-nums">{formatYen(share)}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {splitMode === "amount" && Number.isFinite(amountNum) && amountNum > 0 && (
              <p className={`text-xs text-right ${amountsMatch ? "text-muted-foreground" : "text-destructive"}`}>
                内訳合計 ¥{amountsSum.toLocaleString("ja-JP")} / 金額 ¥{amountNum.toLocaleString("ja-JP")}
                {!amountsMatch && `（差 ¥${Math.abs(amountNum - amountsSum).toLocaleString("ja-JP")}）`}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={mutation.isPending}
            data-testid="button-submit-payment"
          >
            {mutation.isPending ? "保存中..." : isEdit ? "更新する" : "追加する"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
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

  const mutation = useMutation({
    mutationFn: async (memberName: string) => {
      const res = await apiRequest("POST", `/api/events/${eventId}/members`, { name: memberName });
      return res.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "members"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
      toast({ title: "メンバーを追加しました" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-4">
        <DialogHeader>
          <DialogTitle className="text-base">メンバーを追加</DialogTitle>
          <DialogDescription className="text-sm">後から参加する人を追加できます</DialogDescription>
        </DialogHeader>
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
          <Button type="submit" className="w-full" disabled={mutation.isPending || !name.trim()} data-testid="button-submit-member">
            {mutation.isPending ? "追加中..." : "追加する"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-4">
        <DialogHeader>
          <DialogTitle className="text-base">イベントを共有</DialogTitle>
          <DialogDescription className="text-sm">リンクや QR コードで仲間を招待できます</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {qr && (
            <div className="flex justify-center">
              <img src={qr} alt="QRコード" className="rounded-lg border border-border" width={180} height={180} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-sm">共有リンク</Label>
            <div className="flex gap-2">
              <Input readOnly value={shareUrl} className="text-xs" data-testid="input-share-url" onFocus={(e) => e.target.select()} />
              <Button type="button" variant="outline" size="icon" onClick={handleCopy} data-testid="button-copy-link" aria-label="リンクをコピー">
                {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            合言葉でも参加できます： <span className="font-semibold text-foreground">{event.keyword}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 各自の収支バー
// ---------------------------------------------------------------------------
function BalanceBar({ name, balance, max }: { name: string; balance: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(balance) / max) * 100) : 0;
  const positive = balance >= 0;
  return (
    <div className="space-y-1" data-testid={`balance-${name}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-foreground truncate">{name}</span>
        <span className={positive ? "text-primary font-semibold tabular-nums" : "text-destructive font-semibold tabular-nums"}>
          {formatSignedYen(balance)}
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden flex">
        <div className="w-1/2 flex justify-end">
          {!positive && <div className="h-full rounded-l-full bg-destructive" style={{ width: `${pct}%` }} />}
        </div>
        <div className="w-1/2 flex justify-start">
          {positive && <div className="h-full rounded-r-full bg-primary" style={{ width: `${pct}%` }} />}
        </div>
      </div>
    </div>
  );
}

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = parseInt(id ?? "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const queryClientHook = useQueryClient();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settleConfirmOpen, setSettleConfirmOpen] = useState(false);
  const [keywordCopied, setKeywordCopied] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const settlementRef = useRef<HTMLDivElement>(null);

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

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId: number) => {
      await apiRequest("DELETE", `/api/events/${eventId}/payments/${paymentId}`);
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "payments"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
      toast({ title: "支払いを削除しました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
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
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6">
            <p className="text-muted-foreground text-sm mb-4">無効なイベントIDです</p>
            <Button onClick={() => setLocation("/")} variant="outline">ホームへ戻る</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/">
              <button className="p-1 rounded-md hover:bg-accent transition-colors" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Link>
            <WaricanLogo className="w-7 h-7 text-primary flex-shrink-0" />
            {eventQuery.isLoading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <span className="font-bold text-sm text-foreground truncate max-w-[140px]">
                {event?.name ?? "イベント"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {event?.isSettled && (
              <Badge variant="secondary" className="text-xs">精算済み</Badge>
            )}
            {event && (
              <Button variant="ghost" size="icon" onClick={() => setShareOpen(true)} data-testid="button-share" aria-label="共有">
                <Share2 className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              data-testid="button-toggle-theme"
              aria-label="テーマ切り替え"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 max-w-lg mx-auto w-full">
        {/* Keyword chip */}
        {event && (
          <button
            onClick={handleCopyKeyword}
            className="inline-flex items-center gap-1.5 mb-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-copy-keyword"
          >
            合言葉: <span className="font-semibold text-foreground">{event.keyword}</span>
            {keywordCopied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          </button>
        )}

        {/* Members bar */}
        {membersQuery.isLoading ? (
          <div className="flex gap-2 mb-4">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-20 rounded-full" />)}
          </div>
        ) : memberList.length > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Users className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            {memberList.map((m) => (
              <Badge key={m.id} variant="secondary" className="text-xs" data-testid={`badge-member-${m.id}`}>
                {m.name}
              </Badge>
            ))}
            {!event?.isSettled && memberList.length < 50 && (
              <button
                onClick={() => setAddMemberOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                data-testid="button-add-member"
              >
                <UserPlus className="h-3.5 w-3.5" /> 追加
              </button>
            )}
          </div>
        )}

        <Tabs defaultValue="payments" className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="payments" className="flex-1" data-testid="tab-payments">
              <Receipt className="h-4 w-4 mr-1.5" />
              支払い一覧
            </TabsTrigger>
            <TabsTrigger value="settlement" className="flex-1" data-testid="tab-settlement">
              <Wallet className="h-4 w-4 mr-1.5" />
              精算結果
            </TabsTrigger>
          </TabsList>

          {/* Payments Tab */}
          <TabsContent value="payments">
            {!event?.isSettled && (
              <Button
                className="w-full mb-4"
                onClick={() => { setEditingPayment(null); setPaymentDialogOpen(true); }}
                data-testid="button-add-payment"
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                支払いを追加
              </Button>
            )}

            {/* Summary row */}
            {paymentList.length > 0 && (
              <div className="flex items-center justify-between mb-3 text-xs text-muted-foreground">
                <span>支払い {paymentList.length} 件</span>
                <span>合計 <span className="font-semibold text-foreground">{formatYen(totalSpent)}</span></span>
              </div>
            )}

            {paymentsQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="pt-4 pb-4">
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-4 w-1/2" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : paymentList.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground mb-1 font-medium">まだ支払いがありません</p>
                  <p className="text-xs text-muted-foreground">「支払いを追加」ボタンで記録を始めましょう</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {sortedPayments.map((p) => {
                  const splitIds: number[] = JSON.parse(p.splitMemberIds);
                  const isAllMembers = splitIds.length === memberList.length;
                  const mode = (p.splitMode ?? "equal") as SplitMode;
                  return (
                    <Card key={p.id} data-testid={`card-payment-${p.id}`}>
                      <CardContent className="pt-3 pb-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <span className="font-semibold text-sm text-foreground">{formatYen(p.amount)}</span>
                            <span className="text-xs text-muted-foreground">← {getMemberName(p.payerId)}</span>
                            {mode !== "equal" && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{SPLIT_MODE_LABEL[mode]}</Badge>
                            )}
                          </div>
                          <p className="text-sm text-foreground mb-1">{p.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {isAllMembers && mode === "equal"
                              ? "全員で割り勘"
                              : `${splitIds.map((memberId) => getMemberName(memberId)).join("、")} で割り勘`}
                          </p>
                        </div>
                        {!event?.isSettled && (
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-primary h-7 w-7"
                              onClick={() => { setEditingPayment(p); setPaymentDialogOpen(true); }}
                              data-testid={`button-edit-payment-${p.id}`}
                              aria-label="支払いを編集"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive h-7 w-7"
                              onClick={() => setPaymentToDelete(p)}
                              disabled={deletePaymentMutation.isPending}
                              data-testid={`button-delete-payment-${p.id}`}
                              aria-label="支払いを削除"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
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

          {/* Settlement Tab */}
          <TabsContent value="settlement">
            {settlementQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <Card key={i}>
                    <CardContent className="pt-4 pb-4"><Skeleton className="h-5 w-full" /></CardContent>
                  </Card>
                ))}
              </div>
            ) : paymentList.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Wallet className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground mb-1 font-medium">支払いを追加してください</p>
                  <p className="text-xs text-muted-foreground">支払いを記録すると精算結果が表示されます</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <div ref={settlementRef} className="space-y-4 bg-background">
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-2">
                    <Card>
                      <CardContent className="p-3 text-center">
                        <p className="text-[10px] text-muted-foreground mb-0.5">総支出</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{formatYen(totalSpent)}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3 text-center">
                        <p className="text-[10px] text-muted-foreground mb-0.5">件数</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{paymentList.length}</p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-3 text-center">
                        <p className="text-[10px] text-muted-foreground mb-0.5">1人平均</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{formatYen(perPersonAvg)}</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Balance bars */}
                  {settlement && memberList.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm font-semibold">各自の収支</CardTitle>
                        <CardDescription className="text-xs">プラスは受け取り、マイナスは支払い</CardDescription>
                      </CardHeader>
                      <CardContent className="pb-4 space-y-3">
                        {memberList.map((m) => (
                          <BalanceBar key={m.id} name={m.name} balance={Math.round(settlement.balances[m.id] ?? 0)} max={maxAbsBalance} />
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Transfers */}
                  {settlement?.transfers.length === 0 ? (
                    <Card>
                      <CardContent className="py-6 text-center">
                        <CheckCircle2 className="h-8 w-8 text-primary mx-auto mb-2" />
                        <p className="text-sm font-medium text-foreground">精算不要！</p>
                        <p className="text-xs text-muted-foreground">全員の収支はすでにバランスが取れています</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <CardHeader className="pb-2 pt-4">
                        <CardTitle className="text-sm font-semibold">送金リスト</CardTitle>
                        <CardDescription className="text-xs">最小の回数で精算できます</CardDescription>
                      </CardHeader>
                      <CardContent className="pb-4 space-y-2">
                        {settlement?.transfers.map((t, i) => (
                          <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50" data-testid={`transfer-${i}`}>
                            <span className="text-sm font-medium text-foreground">{t.from}</span>
                            <ArrowRight className="h-4 w-4 text-primary flex-shrink-0" />
                            <span className="text-sm font-medium text-foreground">{t.to}</span>
                            <span className="ml-auto text-sm font-bold text-primary">{formatYen(t.amount)}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Export actions */}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopySummary} data-testid="button-copy-summary">
                    <ClipboardCopy className="h-4 w-4 mr-1" /> コピー
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownloadCsv} data-testid="button-download-csv">
                    <FileDown className="h-4 w-4 mr-1" /> CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownloadImage} disabled={exportingImage} data-testid="button-download-image">
                    <ImageIcon className="h-4 w-4 mr-1" /> {exportingImage ? "..." : "画像"}
                  </Button>
                </div>

                {/* Settle */}
                {!event?.isSettled ? (
                  <Button
                    variant="outline"
                    className="w-full border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                    onClick={() => setSettleConfirmOpen(true)}
                    disabled={settleMutation.isPending}
                    data-testid="button-settle"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {settleMutation.isPending ? "精算中..." : "精算する"}
                  </Button>
                ) : (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardContent className="py-4 flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">精算済み</p>
                        <p className="text-xs text-muted-foreground">このイベントは精算が完了しています</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Dialogs */}
      <PaymentDialog
        open={paymentDialogOpen}
        onOpenChange={(v) => { setPaymentDialogOpen(v); if (!v) setEditingPayment(null); }}
        eventId={eventId}
        members={memberList}
        payment={editingPayment}
      />
      <AddMemberDialog open={addMemberOpen} onOpenChange={setAddMemberOpen} eventId={eventId} />
      {event && <ShareDialog open={shareOpen} onOpenChange={setShareOpen} event={event} />}

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
