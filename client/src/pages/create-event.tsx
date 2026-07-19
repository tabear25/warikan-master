import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { MemberAvatar } from "@/components/member-avatar";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_ICON, EVENT_TYPE_LABEL } from "@/lib/schedule";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import type { Event, EventType, Member } from "@shared/schema";
import { EVENT_TYPES, LIMITS } from "@shared/schema";

import { SPRING, fadeUp } from "@/lib/motion";

export default function CreateEvent() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [eventName, setEventName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [eventType, setEventType] = useState<EventType>("meal");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [memberNames, setMemberNames] = useState(["", ""]);

  const createMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      keyword: string;
      memberNames: string[];
      type: EventType;
      startDate?: string;
      endDate?: string;
    }) => {
      const res = await apiRequest("POST", "/api/events", data);
      return res.json() as Promise<{ event: Event; members: Member[] }>;
    },
    onSuccess: (data) => {
      toast({
        title: "イベントを作成しました🎉",
        description: `「${data.event.name}」が作成されました`,
      });
      setLocation(`/event/${data.event.id}`);
    },
    onError: (err: Error) => {
      const msg = err.message.includes("409")
        ? "その合言葉はすでに使われています"
        : err.message.replace(/^\d+: /, "");
      toast({ title: "エラー", description: msg, variant: "destructive" });
    },
  });

  const addMember = () => {
    setMemberNames((prev) => [...prev, ""]);
  };

  const removeMember = (index: number) => {
    if (memberNames.length <= 2) return;
    setMemberNames((prev) => prev.filter((_, i) => i !== index));
  };

  const updateMember = (index: number, value: string) => {
    setMemberNames((prev) => prev.map((n, i) => (i === index ? value : n)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validNames = memberNames.map((n) => n.trim()).filter((n) => n.length > 0);
    if (validNames.length < 2) {
      toast({
        title: "メンバーが足りません",
        description: "メンバーは2人以上入力してください",
        variant: "destructive",
      });
      return;
    }
    if (new Set(validNames).size !== validNames.length) {
      toast({
        title: "メンバー名が重複しています",
        description: "同じ名前のメンバーは登録できません",
        variant: "destructive",
      });
      return;
    }
    if (!eventName.trim() || !keyword.trim()) {
      toast({
        title: "入力が不完全です",
        description: "イベント名と合言葉を入力してください",
        variant: "destructive",
      });
      return;
    }
    const isTrip = eventType === "trip";
    if (isTrip && startDate && endDate && endDate < startDate) {
      toast({
        title: "日程が正しくありません",
        description: "終了日は開始日以降にしてください",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      name: eventName.trim(),
      keyword: keyword.trim(),
      memberNames: validNames,
      type: eventType,
      // 日程は旅行タイプのときだけ送る（任意入力）
      startDate: isTrip && startDate ? startDate : undefined,
      endDate: isTrip && endDate ? endDate : undefined,
    });
  };

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background">

      <AppHeader
        backHref="/"
        title={<span className="text-sm font-bold tracking-tight text-foreground">イベント作成</span>}
      />

      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg space-y-4 lg:max-w-3xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
            {/* Event Info Card */}
            <motion.div {...fadeUp} transition={SPRING}>
              <Card className="rounded-3xl">
                <CardHeader className="pb-3">
                  <p className="font-display text-xs font-bold uppercase tracking-[0.25em] text-primary">
                    Step 01
                  </p>
                  <CardTitle className="text-base">イベント情報</CardTitle>
                  <CardDescription className="text-sm">イベントを設定します</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="event-name" className="text-sm">イベント名 <span className="text-destructive">*</span></Label>
                    <Input
                      id="event-name"
                      data-testid="input-event-name"
                      placeholder="例：京都旅行2026"
                      value={eventName}
                      onChange={(e) => setEventName(e.target.value)}
                      disabled={createMutation.isPending}
                      maxLength={LIMITS.eventName}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="keyword" className="text-sm">
                      合言葉 <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="keyword"
                      data-testid="input-keyword"
                      placeholder="例：kyoto2026"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      disabled={createMutation.isPending}
                      maxLength={LIMITS.keyword}
                      required
                      autoComplete="off"
                      className="font-display font-semibold tracking-wide"
                    />
                    <p className="text-xs text-muted-foreground">
                      メンバーはこの合言葉でイベントに参加します
                    </p>
                  </div>

                  {/* イベントの種類（旅行のときだけスケジュール機能が有効になる） */}
                  <div className="space-y-2">
                    <Label className="text-sm">イベントの種類</Label>
                    <RadioGroup
                      value={eventType}
                      onValueChange={(value) => setEventType(value as EventType)}
                      className="grid grid-cols-3 gap-2"
                    >
                      {EVENT_TYPES.map((type) => {
                        const Icon = EVENT_TYPE_ICON[type];
                        return (
                          <label
                            key={type}
                            htmlFor={`event-type-${type}`}
                            className={cn(
                              "flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-2.5 text-xs font-semibold transition-all duration-200",
                              eventType === type
                                ? "border-primary bg-primary/10 text-primary shadow-xs"
                                : "border-border text-muted-foreground hover:border-input hover:text-foreground",
                            )}
                            data-testid={`event-type-${type}`}
                          >
                            <RadioGroupItem value={type} id={`event-type-${type}`} className="sr-only" />
                            <Icon className="h-4 w-4" />
                            {EVENT_TYPE_LABEL[type]}
                          </label>
                        );
                      })}
                    </RadioGroup>
                    {eventType === "trip" && (
                      <p className="text-xs text-muted-foreground">
                        旅行では宿泊・移動などのスケジュールも管理できます
                      </p>
                    )}
                  </div>

                  {/* 旅行の日程（任意） */}
                  {eventType === "trip" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="trip-start" className="text-sm">開始日（任意）</Label>
                        <Input
                          id="trip-start"
                          data-testid="input-trip-start"
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          disabled={createMutation.isPending}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="trip-end" className="text-sm">終了日（任意）</Label>
                        <Input
                          id="trip-end"
                          data-testid="input-trip-end"
                          type="date"
                          value={endDate}
                          min={startDate || undefined}
                          onChange={(e) => setEndDate(e.target.value)}
                          disabled={createMutation.isPending}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>

            {/* Members Card */}
            <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.08 }}>
              <Card className="rounded-3xl">
                <CardHeader className="pb-3">
                  <p className="font-display text-xs font-bold uppercase tracking-[0.25em] text-primary">
                    Step 02
                  </p>
                  <CardTitle className="text-base">メンバー</CardTitle>
                  <CardDescription className="text-sm">参加するメンバーの名前を入力してください（2人以上）</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {memberNames.map((name, index) => (
                    <div key={index} className="flex items-center gap-2.5">
                      <MemberAvatar
                        name={name.trim() || String(index + 1)}
                        className="h-9 w-9 text-sm"
                      />
                      <Input
                        data-testid={`input-member-${index}`}
                        placeholder={`メンバー ${index + 1}`}
                        value={name}
                        onChange={(e) => updateMember(index, e.target.value)}
                        disabled={createMutation.isPending}
                        maxLength={LIMITS.memberName}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeMember(index)}
                        disabled={memberNames.length <= 2 || createMutation.isPending}
                        data-testid={`button-remove-member-${index}`}
                        aria-label="メンバーを削除"
                        className="shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addMember}
                    disabled={createMutation.isPending}
                    data-testid="button-add-member"
                    className="mt-1 w-full border-dashed"
                  >
                    <Plus className="h-4 w-4" />
                    メンバーを追加
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
            </div>

            {/* Submit */}
            <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.16 }} className="lg:mx-auto lg:max-w-md">
              <Button
                type="submit"
                className="w-full"
                disabled={createMutation.isPending}
                data-testid="button-create-event"
                size="lg"
              >
                {createMutation.isPending ? "作成中..." : (
                  <>
                    イベントを作成する
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </motion.div>
          </form>
        </div>
      </main>
    </div>
  );
}
