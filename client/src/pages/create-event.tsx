import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { Moon, Sun, ArrowLeft, Plus, Trash2, ChevronRight } from "lucide-react";
import type { Event, Member } from "@shared/schema";

function WaricanLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-label="Warikan Master ロゴ"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
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

export default function CreateEvent() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

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
            <span className="font-bold text-sm text-foreground">イベント作成</span>
          </div>
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
      </header>

      <main className="flex-1 px-4 py-6">
        <div className="max-w-lg mx-auto space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Event Info Card */}
            <Card>
              <CardHeader className="pb-3">
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
                    required
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">
                    メンバーはこの合言葉でイベントに参加します
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Members Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">メンバー</CardTitle>
                <CardDescription className="text-sm">参加するメンバーの名前を入力してください（2人以上）</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {memberNames.map((name, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold flex-shrink-0">
                      {index + 1}
                    </div>
                    <Input
                      data-testid={`input-member-${index}`}
                      placeholder={`メンバー ${index + 1}`}
                      value={name}
                      onChange={(e) => updateMember(index, e.target.value)}
                      disabled={createMutation.isPending}
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
                      className="text-muted-foreground hover:text-destructive flex-shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMember}
                  disabled={createMutation.isPending}
                  data-testid="button-add-member"
                  className="w-full mt-1"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  メンバーを追加
                </Button>
              </CardContent>
            </Card>

            {/* Submit */}
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
                  <ChevronRight className="h-4 w-4 ml-1" />
                </>
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
