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
import { Moon, Sun, Users, PlusCircle, KeyRound, HelpCircle } from "lucide-react";
import type { Event, Member } from "@shared/schema";

// SVG Logo: stylized ¥ with a split/divide motif
function WaricanLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-label="Warikan Master ロゴ"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Circle background */}
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
      {/* Yen symbol arms */}
      <path d="M14 10 L24 24 L34 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Yen vertical stem */}
      <path d="M24 24 L24 38" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Yen horizontal bars */}
      <path d="M18 28 L30 28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 33 L30 33" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Split dots on the arms */}
      <circle cx="16" cy="12" r="2" fill="currentColor" opacity="0.5" />
      <circle cx="32" cy="12" r="2" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const joinMutation = useMutation({
    mutationFn: async (kw: string) => {
      const res = await apiRequest("POST", "/api/events/join", { keyword: kw });
      return res.json() as Promise<{ event: Event; members: Member[] }>;
    },
    onSuccess: (data) => {
      setLocation(`/event/${data.event.id}`);
    },
    onError: (err: Error) => {
      toast({
        title: "イベントが見つかりません",
        description: err.message.includes("404") ? "合言葉が間違っています" : err.message,
        variant: "destructive",
      });
    },
  });

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    joinMutation.mutate(keyword.trim());
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WaricanLogo className="w-8 h-8 text-primary" />
            <span className="font-bold text-base text-foreground">Warikan Master</span>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/help">
              <Button
                variant="ghost"
                size="icon"
                data-testid="button-help"
                aria-label="ヘルプ"
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </Link>
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

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg space-y-4">
          {/* Hero */}
          <div className="text-center mb-8">
            <WaricanLogo className="w-16 h-16 text-primary mx-auto mb-4" />
            <h1 className="text-xl font-bold text-foreground mb-2">割り勘マスター</h1>
            <p className="text-sm text-muted-foreground">
              旅行・食事の割り勘をかんたんに。<br />
              合言葉でグループに参加しましょう。
            </p>
          </div>

          {/* Join Card */}
          <Card data-testid="card-join">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                イベントに参加する
              </CardTitle>
              <CardDescription className="text-sm">合言葉を入力してイベントに参加します</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoin} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="keyword" className="text-sm">合言葉</Label>
                  <Input
                    id="keyword"
                    data-testid="input-keyword"
                    placeholder="例：osaka2024"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    disabled={joinMutation.isPending}
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={joinMutation.isPending || !keyword.trim()}
                  data-testid="button-join"
                >
                  {joinMutation.isPending ? "参加中..." : "参加する"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Create Card */}
          <Card data-testid="card-create">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PlusCircle className="h-4 w-4 text-primary" />
                新しいイベントを作成する
              </CardTitle>
              <CardDescription className="text-sm">
                旅行や食事のイベントを作って、みんなを招待しましょう
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => setLocation("/create")}
                data-testid="button-go-create"
              >
                <Users className="h-4 w-4 mr-2" />
                イベントを作る
              </Button>
            </CardContent>
          </Card>

          {/* Admin link */}
          <div className="text-center pt-2">
            <button
              onClick={() => setLocation("/admin")}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
              data-testid="link-admin"
            >
              管理者ログイン
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
