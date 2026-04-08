import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { Moon, Sun, ArrowLeft, LogOut, Trash2, Calendar, Key, CheckCircle2, ShieldCheck } from "lucide-react";
import type { Event } from "@shared/schema";

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

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

interface AdminCredentials {
  username: string;
  password: string;
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const queryClientHook = useQueryClient();

  const [adminCreds, setAdminCreds] = useState<AdminCredentials | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const loginMutation = useMutation({
    mutationFn: async (data: { username: string; password: string }) => {
      const res = await apiRequest("POST", "/api/admin/login", data);
      return res.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        setAdminCreds({ username, password });
      }
    },
    onError: (err: Error) => {
      toast({
        title: "ログイン失敗",
        description: err.message.includes("401")
          ? "ユーザー名またはパスワードが間違っています"
          : err.message.replace(/^\d+: /, ""),
        variant: "destructive",
      });
    },
  });

  const eventsQuery = useQuery<Event[]>({
    queryKey: ["/api/admin/events"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/events`, {
        headers: {
          "x-admin-username": adminCreds!.username,
          "x-admin-password": adminCreds!.password,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!adminCreds,
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/events/${id}`, {
        method: "DELETE",
        headers: {
          "x-admin-username": adminCreds!.username,
          "x-admin-password": adminCreds!.password,
        },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClientHook.invalidateQueries({ queryKey: ["/api/admin/events"] });
      toast({ title: "イベントを削除しました" });
    },
    onError: (err: Error) => {
      toast({ title: "エラー", description: err.message, variant: "destructive" });
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    loginMutation.mutate({ username: username.trim(), password: password.trim() });
  };

  const handleLogout = () => {
    setAdminCreds(null);
    setUsername("");
    setPassword("");
    queryClientHook.removeQueries({ queryKey: ["/api/admin/events"] });
  };

  const eventList = eventsQuery.data ?? [];

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
            <span className="font-bold text-sm text-foreground">管理者パネル</span>
          </div>
          <div className="flex items-center gap-1">
            {adminCreds && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                data-testid="button-logout"
                className="text-muted-foreground text-xs h-7 px-2"
              >
                <LogOut className="h-3.5 w-3.5 mr-1" />
                ログアウト
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

      <main className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        {!adminCreds ? (
          /* Login Form */
          <div className="flex flex-col items-center justify-center pt-8">
            <Card className="w-full max-w-sm">
              <CardHeader className="text-center pb-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <ShieldCheck className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-base">管理者ログイン</CardTitle>
                <CardDescription className="text-sm">管理者アカウントでログインしてください</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="admin-username" className="text-sm">ユーザー名</Label>
                    <Input
                      id="admin-username"
                      data-testid="input-admin-username"
                      placeholder="admin"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={loginMutation.isPending}
                      autoComplete="username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="admin-password" className="text-sm">パスワード</Label>
                    <Input
                      id="admin-password"
                      data-testid="input-admin-password"
                      type="password"
                      placeholder="••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loginMutation.isPending}
                      autoComplete="current-password"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loginMutation.isPending || !username.trim() || !password.trim()}
                    data-testid="button-admin-login"
                  >
                    {loginMutation.isPending ? "ログイン中..." : "ログイン"}
                  </Button>
                </form>
                <p className="text-xs text-muted-foreground text-center mt-4">
                  初期設定: admin / admin
                </p>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Admin Panel */
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span><strong className="text-foreground">{adminCreds.username}</strong> としてログイン中</span>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">全イベント一覧</CardTitle>
                <CardDescription className="text-sm">
                  {eventsQuery.isLoading
                    ? "読み込み中..."
                    : `${eventList.length}件のイベント`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {eventsQuery.isLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center justify-between">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-7 w-16" />
                      </div>
                    ))}
                  </div>
                ) : eventList.length === 0 ? (
                  <div className="text-center py-8">
                    <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-muted-foreground">イベントがまだありません</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {eventList.map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border"
                        data-testid={`admin-event-${ev.id}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-medium text-sm text-foreground truncate">{ev.name}</span>
                            {ev.isSettled && (
                              <Badge variant="secondary" className="text-xs flex-shrink-0">
                                <CheckCircle2 className="h-3 w-3 mr-0.5" />
                                精算済み
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Key className="h-3 w-3" />
                              {ev.keyword}
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {formatDate(ev.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2"
                            onClick={() => setLocation(`/event/${ev.id}`)}
                            data-testid={`button-view-event-${ev.id}`}
                          >
                            詳細
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                data-testid={`button-delete-event-${ev.id}`}
                                disabled={deleteEventMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>イベントを削除しますか？</AlertDialogTitle>
                                <AlertDialogDescription>
                                  「{ev.name}」とすべての支払い記録が削除されます。この操作は取り消せません。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteEventMutation.mutate(ev.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  data-testid={`button-confirm-delete-event-${ev.id}`}
                                >
                                  削除する
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
