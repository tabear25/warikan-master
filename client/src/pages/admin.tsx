import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
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
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Key,
  LogOut,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  Trash2,
  Users,
} from "lucide-react";
import type { Event, Member } from "@shared/schema";

interface AdminCredentials {
  username: string;
  password: string;
}

interface AdminEvent extends Event {
  members: Member[];
}

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

function buildAdminHeaders(adminCreds: AdminCredentials, includeJson = false): HeadersInit {
  return {
    "x-admin-username": adminCreds.username,
    "x-admin-password": adminCreds.password,
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
  };
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text();

  if (!text) {
    return res.statusText;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text;
  }
}

export default function AdminPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();

  const [adminCreds, setAdminCreds] = useState<AdminCredentials | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [memberInputs, setMemberInputs] = useState<Record<number, string>>({});

  const invalidateEventQueries = (eventId: number) => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
    queryClient.invalidateQueries({ queryKey: ["/api/events", eventId] });
    queryClient.invalidateQueries({ queryKey: ["/api/events", eventId, "members"] });
    queryClient.invalidateQueries({ queryKey: ["/api/events", eventId, "payments"] });
    queryClient.invalidateQueries({ queryKey: ["/api/events", eventId, "settlement"] });
  };

  const loginMutation = useMutation({
    mutationFn: async (data: AdminCredentials) => {
      const res = await apiRequest("POST", "/api/admin/login", data);
      return res.json();
    },
    onSuccess: () => {
      setAdminCreds({ username: username.trim(), password: password.trim() });
      toast({ title: "管理画面にログインしました" });
    },
    onError: (err: Error) => {
      toast({
        title: "ログインに失敗しました",
        description: err.message.includes("401") ? "IDまたはパスワードが違います" : err.message.replace(/^\d+: /, ""),
        variant: "destructive",
      });
    },
  });

  const eventsQuery = useQuery<AdminEvent[]>({
    queryKey: ["/api/admin/events"],
    queryFn: async () => {
      const res = await fetch("/api/admin/events", {
        headers: buildAdminHeaders(adminCreds!),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      return res.json();
    },
    enabled: !!adminCreds,
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (eventId: number) => {
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: "DELETE",
        headers: buildAdminHeaders(adminCreds!),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/events"] });
      toast({ title: "イベントを削除しました" });
    },
    onError: (err: Error) => {
      toast({ title: "イベント削除に失敗しました", description: err.message, variant: "destructive" });
    },
  });

  const toggleSettlementMutation = useMutation({
    mutationFn: async ({ eventId, isSettled }: { eventId: number; isSettled: boolean }) => {
      const res = await fetch(`/api/admin/events/${eventId}/settlement`, {
        method: "PATCH",
        headers: buildAdminHeaders(adminCreds!, true),
        body: JSON.stringify({ isSettled }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidateEventQueries(variables.eventId);
      toast({
        title: variables.isSettled ? "清算済みに変更しました" : "未精算に戻しました",
      });
    },
    onError: (err: Error) => {
      toast({ title: "清算状態の変更に失敗しました", description: err.message, variant: "destructive" });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async ({ eventId, name }: { eventId: number; name: string }) => {
      const res = await fetch(`/api/admin/events/${eventId}/members`, {
        method: "POST",
        headers: buildAdminHeaders(adminCreds!, true),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      setMemberInputs((prev) => ({ ...prev, [variables.eventId]: "" }));
      invalidateEventQueries(variables.eventId);
      toast({ title: "メンバーを追加しました" });
    },
    onError: (err: Error) => {
      toast({ title: "メンバー追加に失敗しました", description: err.message, variant: "destructive" });
    },
  });

  const deleteMemberMutation = useMutation({
    mutationFn: async ({ eventId, memberId }: { eventId: number; memberId: number }) => {
      const res = await fetch(`/api/admin/events/${eventId}/members/${memberId}`, {
        method: "DELETE",
        headers: buildAdminHeaders(adminCreds!),
      });
      if (!res.ok) {
        throw new Error(await readErrorMessage(res));
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      invalidateEventQueries(variables.eventId);
      toast({ title: "メンバーを削除しました" });
    },
    onError: (err: Error) => {
      toast({ title: "メンバー削除に失敗しました", description: err.message, variant: "destructive" });
    },
  });

  const handleLogin = (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      return;
    }
    loginMutation.mutate({ username: username.trim(), password: password.trim() });
  };

  const handleLogout = () => {
    setAdminCreds(null);
    setUsername("");
    setPassword("");
    setMemberInputs({});
    queryClient.removeQueries({ queryKey: ["/api/admin/events"] });
  };

  const handleAddMember = (eventId: number) => {
    const name = memberInputs[eventId]?.trim() ?? "";
    if (!name) {
      toast({ title: "追加するメンバー名を入力してください", variant: "destructive" });
      return;
    }
    addMemberMutation.mutate({ eventId, name });
  };

  const eventList = eventsQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link href="/">
              <button className="p-1 rounded-md hover:bg-accent transition-colors" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </button>
            </Link>
            <WaricanLogo className="w-7 h-7 text-primary" />
            <span className="font-bold text-sm text-foreground">管理パネル</span>
          </div>
          <div className="flex items-center gap-1">
            {adminCreds && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                data-testid="button-logout"
                className="text-muted-foreground text-xs h-8 px-2"
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

      <main className="flex-1 px-4 py-6 max-w-3xl mx-auto w-full">
        {!adminCreds ? (
          <div className="flex flex-col items-center justify-center pt-8">
            <Card className="w-full max-w-sm">
              <CardHeader className="text-center pb-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <ShieldCheck className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-base">管理画面ログイン</CardTitle>
                <CardDescription className="text-sm">
                  管理者アカウントでログインしてください
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="admin-username" className="text-sm">ユーザーID</Label>
                    <Input
                      id="admin-username"
                      data-testid="input-admin-username"
                      placeholder="admin"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
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
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
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
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span>
                <strong className="text-foreground">{adminCreds.username}</strong> としてログイン中
              </span>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">イベント管理</CardTitle>
                <CardDescription className="text-sm">
                  {eventsQuery.isLoading ? "読み込み中..." : `${eventList.length}件のイベント`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {eventsQuery.isLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="space-y-3 rounded-lg border border-border p-4">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ))}
                  </div>
                ) : eventList.length === 0 ? (
                  <div className="text-center py-8">
                    <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-muted-foreground">イベントがまだありません</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {eventList.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-lg border border-border p-4 space-y-4"
                        data-testid={`admin-event-${event.id}`}
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-base text-foreground break-words">{event.name}</span>
                              <Badge variant={event.isSettled ? "secondary" : "outline"} className="text-xs">
                                {event.isSettled ? (
                                  <>
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    清算済み
                                  </>
                                ) : (
                                  "未精算"
                                )}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <Key className="h-3 w-3" />
                                {event.keyword}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {formatDate(event.createdAt)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {event.members.length}人
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => setLocation(`/event/${event.id}`)}
                              data-testid={`button-view-event-${event.id}`}
                            >
                              詳細を見る
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() =>
                                toggleSettlementMutation.mutate({
                                  eventId: event.id,
                                  isSettled: !event.isSettled,
                                })
                              }
                              disabled={toggleSettlementMutation.isPending}
                              data-testid={`button-toggle-settlement-${event.id}`}
                            >
                              {event.isSettled ? "未精算に戻す" : "清算済みにする"}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  data-testid={`button-delete-event-${event.id}`}
                                  disabled={deleteEventMutation.isPending}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>イベントを削除しますか？</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    「{event.name}」に登録されている支払い情報も一緒に削除されます。この操作は元に戻せません。
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteEventMutation.mutate(event.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    data-testid={`button-confirm-delete-event-${event.id}`}
                                  >
                                    削除する
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>

                        <div className="space-y-3 border-t border-border pt-4">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-primary" />
                            <h3 className="text-sm font-medium text-foreground">メンバー管理</h3>
                          </div>

                          <div className="space-y-2">
                            {event.members.map((member) => (
                              <div
                                key={member.id}
                                className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2"
                                data-testid={`admin-member-${event.id}-${member.id}`}
                              >
                                <span className="text-sm text-foreground">{member.name}</span>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      disabled={deleteMemberMutation.isPending}
                                      data-testid={`button-delete-member-${event.id}-${member.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>メンバーを削除しますか？</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        まだ支払いに使われていないメンバーだけ削除できます。
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() =>
                                          deleteMemberMutation.mutate({
                                            eventId: event.id,
                                            memberId: member.id,
                                          })
                                        }
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        data-testid={`button-confirm-delete-member-${event.id}-${member.id}`}
                                      >
                                        削除する
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                              placeholder="追加するメンバー名"
                              value={memberInputs[event.id] ?? ""}
                              onChange={(inputEvent) =>
                                setMemberInputs((prev) => ({
                                  ...prev,
                                  [event.id]: inputEvent.target.value,
                                }))
                              }
                              data-testid={`input-member-name-${event.id}`}
                            />
                            <Button
                              type="button"
                              className="sm:w-auto"
                              onClick={() => handleAddMember(event.id)}
                              disabled={addMemberMutation.isPending}
                              data-testid={`button-add-member-${event.id}`}
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              メンバー追加
                            </Button>
                          </div>

                          <p className="text-xs text-muted-foreground">
                            支払い済みデータに含まれているメンバーは削除できません。必要なら先に支払い情報側を調整してください。
                          </p>
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
