import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminHeaders, apiJson } from "@/api/client";
import {
  clearAdminCredentials,
  loadAdminCredentials,
  saveAdminCredentials,
  type AdminCredentials,
} from "@/storage/admin";
import { useToast } from "@/components/Toast";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Badge, Button, Card, Field, IconButton, Muted, Title } from "@/components/ui";
import { useTheme } from "@/theme";
import type { AdminEvent } from "@/lib/types";
import type { ScreenProps } from "@/navigation/types";

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function AdminScreen({ navigation }: ScreenProps<"Admin">) {
  const { colors } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [creds, setCreds] = useState<AdminCredentials | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [memberInputs, setMemberInputs] = useState<Record<number, string>>({});

  // Restore a saved session on mount.
  useEffect(() => {
    loadAdminCredentials()
      .then((saved) => {
        if (saved) setCreds(saved);
      })
      .finally(() => setRestoring(false));
  }, []);

  const loginMutation = useMutation({
    mutationFn: (data: AdminCredentials) => apiJson("POST", "/api/admin/login", data),
    onSuccess: async (_data, variables) => {
      setCreds(variables);
      await saveAdminCredentials(variables);
      toast({ title: "管理画面にログインしました" });
    },
    onError: (err: Error) => {
      toast({
        title: "ログインに失敗しました",
        description: err.message.includes("401") ? "IDまたはパスワードが違います" : err.message,
        variant: "destructive",
      });
    },
  });

  const eventsQuery = useQuery<AdminEvent[]>({
    queryKey: ["admin", "events"],
    queryFn: () => apiJson<AdminEvent[]>("GET", "/api/admin/events", undefined, adminHeaders(creds!)),
    enabled: !!creds,
  });

  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ["admin", "events"] });

  const deleteEventMutation = useMutation({
    mutationFn: (eventId: number) =>
      apiJson("DELETE", `/api/admin/events/${eventId}`, undefined, adminHeaders(creds!)),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "イベントを削除しました" });
    },
    onError: (err: Error) => toast({ title: "イベント削除に失敗しました", description: err.message, variant: "destructive" }),
  });

  const toggleSettlementMutation = useMutation({
    mutationFn: (vars: { eventId: number; isSettled: boolean }) =>
      apiJson("PATCH", `/api/admin/events/${vars.eventId}/settlement`, { isSettled: vars.isSettled }, adminHeaders(creds!, true)),
    onSuccess: (_data, vars) => {
      invalidateAll();
      toast({ title: vars.isSettled ? "清算済みに変更しました" : "未精算に戻しました" });
    },
    onError: (err: Error) => toast({ title: "清算状態の変更に失敗しました", description: err.message, variant: "destructive" }),
  });

  const addMemberMutation = useMutation({
    mutationFn: (vars: { eventId: number; name: string }) =>
      apiJson("POST", `/api/admin/events/${vars.eventId}/members`, { name: vars.name }, adminHeaders(creds!, true)),
    onSuccess: (_data, vars) => {
      setMemberInputs((prev) => ({ ...prev, [vars.eventId]: "" }));
      invalidateAll();
      toast({ title: "メンバーを追加しました" });
    },
    onError: (err: Error) => toast({ title: "メンバー追加に失敗しました", description: err.message, variant: "destructive" }),
  });

  const deleteMemberMutation = useMutation({
    mutationFn: (vars: { eventId: number; memberId: number }) =>
      apiJson("DELETE", `/api/admin/events/${vars.eventId}/members/${vars.memberId}`, undefined, adminHeaders(creds!)),
    onSuccess: () => {
      invalidateAll();
      toast({ title: "メンバーを削除しました" });
    },
    onError: (err: Error) => toast({ title: "メンバー削除に失敗しました", description: err.message, variant: "destructive" }),
  });

  const handleLogin = () => {
    if (!username.trim() || !password.trim()) return;
    loginMutation.mutate({ username: username.trim(), password: password.trim() });
  };

  const handleLogout = async () => {
    setCreds(null);
    setUsername("");
    setPassword("");
    setMemberInputs({});
    await clearAdminCredentials();
    queryClient.removeQueries({ queryKey: ["admin", "events"] });
  };

  const confirmDeleteEvent = (event: AdminEvent) =>
    Alert.alert(
      "イベントを削除しますか？",
      `「${event.name}」に登録されている支払い情報も一緒に削除されます。この操作は元に戻せません。`,
      [
        { text: "キャンセル", style: "cancel" },
        { text: "削除する", style: "destructive", onPress: () => deleteEventMutation.mutate(event.id) },
      ],
    );

  const confirmDeleteMember = (eventId: number, memberId: number) =>
    Alert.alert("メンバーを削除しますか？", "まだ支払いに使われていないメンバーだけ削除できます。", [
      { text: "キャンセル", style: "cancel" },
      { text: "削除する", style: "destructive", onPress: () => deleteMemberMutation.mutate({ eventId, memberId }) },
    ]);

  const eventList = eventsQuery.data ?? [];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top"]}>
      <ScreenHeader
        title="管理パネル"
        onBack={() => navigation.goBack()}
        right={
          creds ? (
            <IconButton name="log-out-outline" onPress={handleLogout} accessibilityLabel="ログアウト" />
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!creds ? (
          <Card style={styles.loginCard}>
            <View style={styles.loginHead}>
              <View style={[styles.shield, { backgroundColor: colors.muted }]}>
                <Ionicons name="shield-checkmark-outline" size={24} color={colors.primary} />
              </View>
              <Title>管理画面ログイン</Title>
              <Muted style={{ textAlign: "center" }}>管理者アカウントでログインしてください</Muted>
            </View>
            <Field
              label="ユーザーID"
              placeholder="admin"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loginMutation.isPending && !restoring}
            />
            <Field
              label="パスワード"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loginMutation.isPending && !restoring}
            />
            <Button
              title={loginMutation.isPending ? "ログイン中..." : "ログイン"}
              onPress={handleLogin}
              loading={loginMutation.isPending}
              disabled={!username.trim() || !password.trim() || restoring}
            />
          </Card>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={styles.loggedInRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
              <Muted>
                <Muted style={{ color: colors.foreground, fontWeight: "700" }}>{creds.username}</Muted>
                {" としてログイン中"}
              </Muted>
            </View>

            <View style={styles.cardHead}>
              <Title>イベント管理</Title>
              <Muted>{eventsQuery.isLoading ? "読み込み中..." : `${eventList.length}件のイベント`}</Muted>
            </View>

            {eventList.length === 0 && !eventsQuery.isLoading ? (
              <Card style={styles.empty}>
                <Ionicons name="calendar-outline" size={28} color={colors.mutedForeground} />
                <Muted>イベントがまだありません</Muted>
              </Card>
            ) : (
              eventList.map((event) => (
                <Card key={event.id} style={styles.eventCard}>
                  <View style={styles.eventTop}>
                    <View style={styles.eventTitleRow}>
                      <Title style={styles.eventName}>{event.name}</Title>
                      <Badge tone={event.isSettled ? "secondary" : "outline"}>
                        {event.isSettled ? "清算済み" : "未精算"}
                      </Badge>
                    </View>
                    <IconButton
                      name="trash-outline"
                      onPress={() => confirmDeleteEvent(event)}
                      color={colors.mutedForeground}
                      accessibilityLabel="イベントを削除"
                    />
                  </View>

                  <View style={styles.metaRow}>
                    <Meta icon="key-outline" text={event.keyword} />
                    <Meta icon="calendar-outline" text={formatDate(event.createdAt)} />
                    <Meta icon="people-outline" text={`${event.members.length}人`} />
                  </View>

                  <View style={styles.eventActions}>
                    <Button
                      title="詳細を見る"
                      variant="outline"
                      onPress={() => navigation.navigate("Event", { eventId: event.id })}
                      style={styles.flexBtn}
                    />
                    <Button
                      title={event.isSettled ? "未精算に戻す" : "清算済みにする"}
                      variant="outline"
                      onPress={() => toggleSettlementMutation.mutate({ eventId: event.id, isSettled: !event.isSettled })}
                      disabled={toggleSettlementMutation.isPending}
                      style={styles.flexBtn}
                    />
                  </View>

                  <View style={[styles.memberSection, { borderTopColor: colors.border }]}>
                    <View style={styles.memberHead}>
                      <Ionicons name="people-outline" size={16} color={colors.primary} />
                      <Title style={{ fontSize: 14 }}>メンバー管理</Title>
                    </View>
                    {event.members.map((member) => (
                      <View key={member.id} style={[styles.memberItem, { backgroundColor: colors.muted }]}>
                        <Muted style={{ color: colors.foreground, fontSize: 14 }}>{member.name}</Muted>
                        <IconButton
                          name="trash-outline"
                          onPress={() => confirmDeleteMember(event.id, member.id)}
                          color={colors.mutedForeground}
                          size={18}
                          accessibilityLabel="メンバーを削除"
                        />
                      </View>
                    ))}
                    <View style={styles.addMemberRow}>
                      <Field
                        style={styles.flexBtn}
                        placeholder="追加するメンバー名"
                        value={memberInputs[event.id] ?? ""}
                        onChangeText={(v) => setMemberInputs((prev) => ({ ...prev, [event.id]: v }))}
                      />
                      <Button
                        title="追加"
                        icon="add"
                        onPress={() => {
                          const name = (memberInputs[event.id] ?? "").trim();
                          if (!name) {
                            toast({ title: "追加するメンバー名を入力してください", variant: "destructive" });
                            return;
                          }
                          addMemberMutation.mutate({ eventId: event.id, name });
                        }}
                        disabled={addMemberMutation.isPending}
                      />
                    </View>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Meta({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={13} color={colors.mutedForeground} />
      <Muted>{text}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  loginCard: { gap: 14, marginTop: 16 },
  loginHead: { alignItems: "center", gap: 6 },
  shield: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  loggedInRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardHead: { gap: 4 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 24 },
  eventCard: { gap: 12 },
  eventTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  eventTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, flexWrap: "wrap" },
  eventName: { fontSize: 16, flexShrink: 1 },
  metaRow: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  eventActions: { flexDirection: "row", gap: 8 },
  flexBtn: { flex: 1 },
  memberSection: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  memberHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  memberItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 4,
  },
  addMemberRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
});
