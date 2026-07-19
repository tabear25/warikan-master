import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import { AppHeader } from "@/components/app-header";
import { MemberAvatar } from "@/components/member-avatar";
import {
  Calendar,
  CheckCircle2,
  Key,
  LogOut,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { EVENT_TYPE_ICON, EVENT_TYPE_LABEL } from "@/lib/schedule";
import type { Event, EventType, Member } from "@shared/schema";
import { EVENT_TYPES } from "@shared/schema";

import { SPRING, fadeUp } from "@/lib/motion";

interface AdminCredentials {
  username: string;
  password: string;
}

interface AdminEvent extends Event {
  members: Member[];
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

// イベント種類のバッジ（旅行 / 食事 / その他）。未知の値は「その他」に落とす。
function EventTypeBadge({ type }: { type: string }) {
  const typeKey: EventType = (EVENT_TYPES as readonly string[]).includes(type)
    ? (type as EventType)
    : "other";
  const Icon = EVENT_TYPE_ICON[typeKey];
  return (
    <Badge variant="outline" className="gap-1 text-xs">
      <Icon className="h-3 w-3 text-primary" />
      {EVENT_TYPE_LABEL[typeKey]}
    </Badge>
  );
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
    <div className="relative isolate flex min-h-screen flex-col bg-background">

      <AppHeader
        backHref="/"
        width="3xl"
        title={<span className="text-sm font-bold tracking-tight text-foreground">管理パネル</span>}
        actions={
          adminCreds ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              data-testid="button-logout"
              className="h-8 px-2.5 text-xs text-muted-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              ログアウト
            </Button>
          ) : undefined
        }
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {!adminCreds ? (
          <div className="flex flex-col items-center justify-center pt-8">
            <motion.div className="w-full max-w-sm" {...fadeUp} transition={SPRING}>
              <Card className="rounded-3xl shadow-lg">
                <CardHeader className="pb-4 text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
                    <ShieldCheck className="h-7 w-7" />
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
                      size="lg"
                      className="w-full"
                      disabled={loginMutation.isPending || !username.trim() || !password.trim()}
                      data-testid="button-admin-login"
                    >
                      {loginMutation.isPending ? "ログイン中..." : "ログイン"}
                    </Button>
                  </form>
                  <p className="mt-4 text-center text-xs text-muted-foreground">
                    初期設定: admin / admin
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        ) : (
          <div className="space-y-4">
            <motion.div
              className="flex items-center gap-2 text-sm text-muted-foreground"
              {...fadeUp}
              transition={SPRING}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
              <span>
                <strong className="text-foreground">{adminCreds.username}</strong> としてログイン中
              </span>
            </motion.div>

            <motion.div {...fadeUp} transition={{ ...SPRING, delay: 0.06 }}>
              <Card className="rounded-3xl">
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
                        <div key={item} className="space-y-3 rounded-2xl border border-border p-4">
                          <Skeleton className="h-5 w-48" />
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-10 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : eventList.length === 0 ? (
                    <div className="py-10 text-center">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
                        <Calendar className="h-6 w-6" />
                      </div>
                      <p className="text-sm text-muted-foreground">イベントがまだありません</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {eventList.map((event) => (
                        <div
                          key={event.id}
                          className="space-y-4 rounded-2xl border border-card-border bg-card p-4 shadow-xs sm:p-5"
                          data-testid={`admin-event-${event.id}`}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="break-words text-base font-bold text-foreground">{event.name}</span>
                                <EventTypeBadge type={event.type} />
                                <Badge variant={event.isSettled ? "secondary" : "outline"} className="text-xs">
                                  {event.isSettled ? (
                                    <>
                                      <CheckCircle2 className="mr-1 h-3 w-3 text-positive" />
                                      清算済み
                                    </>
                                  ) : (
                                    "未精算"
                                  )}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Key className="h-3 w-3" />
                                  <span className="font-display font-semibold">{event.keyword}</span>
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

                            <div className="flex flex-wrap items-center gap-2">
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
                                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
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
                              <h3 className="text-sm font-semibold text-foreground">メンバー管理</h3>
                            </div>

                            <div className="space-y-2">
                              {event.members.map((member) => (
                                <div
                                  key={member.id}
                                  className="flex items-center justify-between gap-3 rounded-xl bg-accent/50 py-1.5 pl-1.5 pr-2"
                                  data-testid={`admin-member-${event.id}-${member.id}`}
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <MemberAvatar name={member.name} className="h-7 w-7 text-[10px]" />
                                    <span className="truncate text-sm font-medium text-foreground">{member.name}</span>
                                  </span>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
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
                                <Plus className="h-4 w-4" />
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
            </motion.div>
          </div>
        )}
      </main>
    </div>
  );
}
