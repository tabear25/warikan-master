import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
  Wallet
} from "lucide-react";
import type { Event, Member, Payment } from "@shared/schema";

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

function formatAmount(amount: number): string {
  return `¥${Math.round(amount).toLocaleString("ja-JP")}`;
}

interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: number;
  members: Member[];
}

function AddPaymentDialog({ open, onOpenChange, eventId, members }: AddPaymentDialogProps) {
  const { toast } = useToast();
  const queryClientHook = useQueryClient();
  const [payerId, setPayerId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [splitAll, setSplitAll] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>(members.map((m) => m.id));

  const resetForm = () => {
    setPayerId("");
    setAmount("");
    setDescription("");
    setSplitAll(true);
    setSelectedIds(members.map((m) => m.id));
  };

  const addMutation = useMutation({
    mutationFn: async (data: { payerId: number; amount: number; description: string; splitMemberIds: number[] }) => {
      const res = await apiRequest("POST", `/api/events/${eventId}/payments`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "payments"] });
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
      toast({ title: "支払いを追加しました" });
      onOpenChange(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message.replace(/^\d+: /, ""), variant: "destructive" });
    },
  });

  const toggleMember = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amtNum = parseFloat(amount);
    if (!payerId || isNaN(amtNum) || amtNum <= 0 || !description.trim()) {
      toast({ title: "入力が不完全です", description: "すべての項目を入力してください", variant: "destructive" });
      return;
    }
    const finalIds = splitAll ? members.map((m) => m.id) : selectedIds;
    if (finalIds.length === 0) {
      toast({ title: "割り勘対象を選んでください", variant: "destructive" });
      return;
    }
    addMutation.mutate({
      payerId: parseInt(payerId),
      amount: amtNum,
      description: description.trim(),
      splitMemberIds: finalIds,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="max-w-sm mx-4">
        <DialogHeader>
          <DialogTitle className="text-base">支払いを追加</DialogTitle>
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

          <div className="space-y-2">
            <Label className="text-sm">割り勘する人</Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="split-all"
                data-testid="checkbox-split-all"
                checked={splitAll}
                onCheckedChange={(v) => setSplitAll(!!v)}
              />
              <label htmlFor="split-all" className="text-sm cursor-pointer">全員で割り勘</label>
            </div>
            {!splitAll && (
              <div className="space-y-1.5 ml-1">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`split-member-${m.id}`}
                      data-testid={`checkbox-split-member-${m.id}`}
                      checked={selectedIds.includes(m.id)}
                      onCheckedChange={() => toggleMember(m.id)}
                    />
                    <label htmlFor={`split-member-${m.id}`} className="text-sm cursor-pointer">{m.name}</label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={addMutation.isPending}
            data-testid="button-submit-payment"
          >
            {addMutation.isPending ? "追加中..." : "追加する"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = parseInt(id ?? "0");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const queryClientHook = useQueryClient();
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);

  const eventQuery = useQuery<Event>({
    queryKey: ["/api/events", eventId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${eventId}`);
      return res.json();
    },
    enabled: !isNaN(eventId) && eventId > 0,
  });

  const membersQuery = useQuery<Member[]>({
    queryKey: ["/api/events", eventId, "members"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${eventId}/members`);
      return res.json();
    },
    enabled: !isNaN(eventId) && eventId > 0,
  });

  const paymentsQuery = useQuery<Payment[]>({
    queryKey: ["/api/events", eventId, "payments"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${eventId}/payments`);
      return res.json();
    },
    enabled: !isNaN(eventId) && eventId > 0,
  });

  const settlementQuery = useQuery<{ transfers: Array<{ from: string; to: string; amount: number }>; balances: Record<number, number> }>({
    queryKey: ["/api/events", eventId, "settlement"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/events/${eventId}/settlement`);
      return res.json();
    },
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
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const settleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/events/${eventId}/settle`);
      return res.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/events", eventId] });
      toast({ title: "精算が完了しました！", description: "このイベントは精算済みになりました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const event = eventQuery.data;
  const memberList = membersQuery.data ?? [];
  const paymentList = paymentsQuery.data ?? [];
  const settlement = settlementQuery.data;

  const getMemberName = (id: number) => memberList.find((m) => m.id === id)?.name ?? "不明";

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
          <div className="flex items-center gap-2">
            <Link href="/">
              <button className="p-1 rounded-md hover:bg-accent transition-colors" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Link>
            <WaricanLogo className="w-7 h-7 text-primary" />
            {eventQuery.isLoading ? (
              <Skeleton className="h-4 w-24" />
            ) : (
              <span className="font-bold text-sm text-foreground truncate max-w-[150px]">
                {event?.name ?? "イベント"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {event?.isSettled && (
              <Badge variant="secondary" className="text-xs">精算済み</Badge>
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
        {/* Event info skeleton */}
        {eventQuery.isLoading && (
          <div className="space-y-2 mb-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
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
                onClick={() => setAddPaymentOpen(true)}
                data-testid="button-add-payment"
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                支払いを追加
              </Button>
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
                {paymentList.map((p) => {
                  const splitIds: number[] = JSON.parse(p.splitMemberIds);
                  const isAllMembers = splitIds.length === memberList.length;
                  return (
                    <Card key={p.id} data-testid={`card-payment-${p.id}`}>
                      <CardContent className="pt-3 pb-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold text-sm text-foreground">{formatAmount(p.amount)}</span>
                            <span className="text-xs text-muted-foreground">← {getMemberName(p.payerId)}</span>
                          </div>
                          <p className="text-sm text-foreground mb-1">{p.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {isAllMembers
                              ? "全員で割り勘"
                              : `${splitIds.map((id) => getMemberName(id)).join("、")} で割り勘`}
                          </p>
                        </div>
                        {!event?.isSettled && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-destructive flex-shrink-0 h-7 w-7"
                            onClick={() => deletePaymentMutation.mutate(p.id)}
                            disabled={deletePaymentMutation.isPending}
                            data-testid={`button-delete-payment-${p.id}`}
                            aria-label="支払いを削除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Settlement Tab */}
          <TabsContent value="settlement">
            {settlementQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <Card key={i}>
                    <CardContent className="pt-4 pb-4">
                      <Skeleton className="h-5 w-full" />
                    </CardContent>
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
                {/* Balance summary */}
                {settlement && memberList.length > 0 && (
                  <Card>
                    <CardHeader className="pb-2 pt-4">
                      <CardTitle className="text-sm font-semibold">各自の収支</CardTitle>
                    </CardHeader>
                    <CardContent className="pb-4 space-y-1.5">
                      {memberList.map((m) => {
                        const bal = settlement.balances[m.id] ?? 0;
                        const rounded = Math.round(bal);
                        return (
                          <div key={m.id} className="flex items-center justify-between text-sm" data-testid={`balance-${m.id}`}>
                            <span className="text-foreground">{m.name}</span>
                            <span className={rounded >= 0 ? "text-primary font-medium" : "text-destructive font-medium"}>
                              {rounded >= 0 ? `+${formatAmount(rounded)}` : formatAmount(rounded)}
                            </span>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                )}

                {/* Transfers */}
                {settlement?.transfers.length === 0 ? (
                  <Card>
                    <CardContent className="py-6 text-center">
                      <CheckCircle2 className="h-8 w-8 text-primary mx-auto mb-2" />
                      <p className="text-sm font-medium text-foreground">清算不要！</p>
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
                          <span className="ml-auto text-sm font-bold text-primary">{formatAmount(t.amount)}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Settle button */}
                {!event?.isSettled && (
                  <Button
                    variant="outline"
                    className="w-full border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                    onClick={() => settleMutation.mutate()}
                    disabled={settleMutation.isPending}
                    data-testid="button-settle"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {settleMutation.isPending ? "精算中..." : "精算する"}
                  </Button>
                )}

                {event?.isSettled && (
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

      {/* Add Payment Dialog */}
      <AddPaymentDialog
        open={addPaymentOpen}
        onOpenChange={setAddPaymentOpen}
        eventId={eventId}
        members={memberList}
      />
    </div>
  );
}
