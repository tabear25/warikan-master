import { useState } from "react";
import { useLocation, Link } from "wouter";
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
import { LogoTile } from "@/components/logo";
import { ArrowRight, Coins, HelpCircle, KeyRound, PlusCircle, QrCode, Users } from "lucide-react";
import type { Event, Member } from "@shared/schema";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
};

const FEATURES = [
  { icon: KeyRound, label: "合言葉だけで参加" },
  { icon: Coins, label: "1円単位でピッタリ精算" },
  { icon: QrCode, label: "QRでサッと共有" },
] as const;

export default function Home() {
  const [, setLocation] = useLocation();
  const [keyword, setKeyword] = useState("");
  const { toast } = useToast();

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
    <div className="relative isolate flex min-h-screen flex-col bg-background">
      <Aurora />

      <AppHeader
        title={
          <span className="font-display text-base font-bold tracking-tight text-foreground">
            Warikan Master
          </span>
        }
        actions={
          <Link href="/help">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              data-testid="button-help"
              aria-label="ヘルプ"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </Link>
        }
      />

      {/* Main */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg space-y-4">
          {/* Hero */}
          <motion.div
            className="mb-10 text-center"
            {...fadeUp}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <LogoTile className="mx-auto mb-6 h-20 w-20" />
            <p className="mb-3 font-display text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
              Split bills, beautifully
            </p>
            <h1 className="mb-3 text-3xl font-black tracking-tight text-foreground">
              割り勘マスター
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              旅行・食事の割り勘をかんたんに。<br />
              合言葉でグループに参加しましょう。
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {FEATURES.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur-sm"
                >
                  <Icon className="h-3 w-3 text-primary" />
                  {label}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Join Card */}
          <motion.div {...fadeUp} transition={{ duration: 0.55, ease: EASE, delay: 0.1 }}>
            <Card data-testid="card-join" className="rounded-3xl shadow-lg">
              <CardHeader className="pb-3">
                <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <KeyRound className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">イベントに参加する</CardTitle>
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
                      className="h-12 text-center font-display text-base font-semibold tracking-wide"
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={joinMutation.isPending || !keyword.trim()}
                    data-testid="button-join"
                  >
                    {joinMutation.isPending ? "参加中..." : (
                      <>
                        参加する
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </motion.div>

          {/* Create Card */}
          <motion.div {...fadeUp} transition={{ duration: 0.55, ease: EASE, delay: 0.18 }}>
            <Card data-testid="card-create" className="rounded-3xl">
              <CardHeader className="pb-3">
                <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <PlusCircle className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">新しいイベントを作成する</CardTitle>
                <CardDescription className="text-sm">
                  旅行や食事のイベントを作って、みんなを招待しましょう
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="lg"
                  className="w-full"
                  variant="outline"
                  onClick={() => setLocation("/create")}
                  data-testid="button-go-create"
                >
                  <Users className="h-4 w-4" />
                  イベントを作る
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          {/* Admin link */}
          <motion.div
            className="pt-2 text-center"
            {...fadeUp}
            transition={{ duration: 0.55, ease: EASE, delay: 0.26 }}
          >
            <button
              onClick={() => setLocation("/admin")}
              className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              data-testid="link-admin"
            >
              管理者ログイン
            </button>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
