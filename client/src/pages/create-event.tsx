import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { Aurora } from "@/components/aurora";
import { MemberAvatar } from "@/components/member-avatar";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import type { Event, Member } from "@shared/schema";
import { LIMITS } from "@shared/schema";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

export default function CreateEvent() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [eventName, setEventName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [memberNames, setMemberNames] = useState(["", ""]);

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; keyword: string; memberNames: string[] }) => {
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
    createMutation.mutate({
      name: eventName.trim(),
      keyword: keyword.trim(),
      memberNames: validNames,
    });
  };

  return (
    <div className="relative isolate flex min-h-screen flex-col bg-background">
      <Aurora />

      <AppHeader
        backHref="/"
        title={<span className="text-sm font-bold tracking-tight text-foreground">イベント作成</span>}
      />

      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Event Info Card */}
            <motion.div {...fadeUp} transition={{ duration: 0.5, ease: EASE }}>
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
                </CardContent>
              </Card>
            </motion.div>

            {/* Members Card */}
            <motion.div {...fadeUp} transition={{ duration: 0.5, ease: EASE, delay: 0.08 }}>
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

            {/* Submit */}
            <motion.div {...fadeUp} transition={{ duration: 0.5, ease: EASE, delay: 0.16 }}>
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
