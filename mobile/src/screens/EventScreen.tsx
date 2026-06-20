import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson, apiRequest } from "@/api/client";
import { useToast } from "@/components/Toast";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PaymentModal } from "@/components/PaymentModal";
import { Badge, Body, Button, Card, IconButton, Muted, Title } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatSignedYen, formatYen } from "@/lib/currency";
import {
  SPLIT_MODE_LABEL,
  type Event,
  type Member,
  type Payment,
  type SettlementResult,
  type SplitMode,
} from "@/lib/types";
import type { ScreenProps } from "@/navigation/types";

type Tab = "payments" | "settlement";

export default function EventScreen({ route, navigation }: ScreenProps<"Event">) {
  const { eventId } = route.params;
  const { colors } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("payments");
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);

  const enabled = Number.isFinite(eventId) && eventId > 0;

  const eventQuery = useQuery<Event>({
    queryKey: ["event", eventId],
    queryFn: () => apiJson<Event>("GET", `/api/events/${eventId}`),
    enabled,
  });
  const membersQuery = useQuery<Member[]>({
    queryKey: ["event", eventId, "members"],
    queryFn: () => apiJson<Member[]>("GET", `/api/events/${eventId}/members`),
    enabled,
  });
  const paymentsQuery = useQuery<Payment[]>({
    queryKey: ["event", eventId, "payments"],
    queryFn: () => apiJson<Payment[]>("GET", `/api/events/${eventId}/payments`),
    enabled,
  });
  const settlementQuery = useQuery<SettlementResult>({
    queryKey: ["event", eventId, "settlement"],
    queryFn: () => apiJson<SettlementResult>("GET", `/api/events/${eventId}/settlement`),
    enabled,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["event", eventId, "payments"] });
    queryClient.invalidateQueries({ queryKey: ["event", eventId, "settlement"] });
  };

  const deletePaymentMutation = useMutation({
    mutationFn: (paymentId: number) => apiRequest("DELETE", `/api/events/${eventId}/payments/${paymentId}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "支払いを削除しました" });
    },
    onError: (err: Error) => toast({ title: "エラー", description: err.message, variant: "destructive" }),
  });

  const settleMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/events/${eventId}/settle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      toast({ title: "精算が完了しました！", description: "このイベントは精算済みになりました" });
    },
    onError: (err: Error) => toast({ title: "エラー", description: err.message, variant: "destructive" }),
  });

  const event = eventQuery.data;
  const memberList = membersQuery.data ?? [];
  const paymentList = paymentsQuery.data ?? [];
  const settlement = settlementQuery.data;

  const getMemberName = (memberId: number) => memberList.find((m) => m.id === memberId)?.name ?? "不明";

  const totalSpent = useMemo(() => paymentList.reduce((acc, p) => acc + Math.round(p.amount), 0), [paymentList]);
  const perPersonAvg = memberList.length > 0 ? Math.round(totalSpent / memberList.length) : 0;
  const maxAbsBalance = useMemo(
    () => Math.max(1, ...memberList.map((m) => Math.abs(Math.round(settlement?.balances[m.id] ?? 0)))),
    [memberList, settlement],
  );
  const sortedPayments = useMemo(
    () => [...paymentList].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [paymentList],
  );

  const copyKeyword = async () => {
    if (!event) return;
    await Clipboard.setStringAsync(event.keyword);
    toast({ title: "合言葉をコピーしました" });
  };

  const handleShare = async () => {
    if (!event) return;
    try {
      await Share.share({
        message: `「${event.name}」の割り勘に参加しよう！\n割り勘マスターアプリで合言葉「${event.keyword}」を入力してください。`,
      });
    } catch {
      // user dismissed share sheet
    }
  };

  const copySummary = async () => {
    if (!event || !settlement) return;
    const lines: string[] = [`【${event.name}】精算結果`, ""];
    lines.push("■ 各自の収支");
    memberList.forEach((m) => {
      lines.push(`${m.name}: ${formatSignedYen(Math.round(settlement.balances[m.id] ?? 0))}`);
    });
    lines.push("", "■ 送金リスト");
    if (settlement.transfers.length === 0) {
      lines.push("精算不要（全員バランス済み）");
    } else {
      settlement.transfers.forEach((t) => lines.push(`${t.from} → ${t.to}: ${formatYen(t.amount)}`));
    }
    await Clipboard.setStringAsync(lines.join("\n"));
    toast({ title: "精算結果をコピーしました" });
  };

  const confirmDeletePayment = (p: Payment) =>
    Alert.alert(
      "この支払いを削除しますか？",
      `${formatYen(p.amount)}（${getMemberName(p.payerId)}）${p.description} を削除します。この操作は取り消せません。`,
      [
        { text: "キャンセル", style: "cancel" },
        { text: "削除する", style: "destructive", onPress: () => deletePaymentMutation.mutate(p.id) },
      ],
    );

  const confirmSettle = () =>
    Alert.alert(
      "このイベントを精算済みにしますか？",
      "精算済みにすると、支払いの追加・編集・削除やメンバーの追加ができなくなります。送金が完了してから実行してください。",
      [
        { text: "キャンセル", style: "cancel" },
        { text: "精算する", onPress: () => settleMutation.mutate() },
      ],
    );

  if (!enabled) {
    return (
      <SafeAreaView style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
        <Card style={{ alignItems: "center", gap: 12 }}>
          <Muted>無効なイベントIDです</Muted>
          <Button title="ホームへ戻る" variant="outline" onPress={() => navigation.navigate("Home")} />
        </Card>
      </SafeAreaView>
    );
  }

  const settled = !!event?.isSettled;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top"]}>
      <ScreenHeader
        title={event?.name ?? "イベント"}
        onBack={() => navigation.navigate("Home")}
        right={
          <>
            {settled ? <Badge tone="secondary">精算済み</Badge> : null}
            {event ? <IconButton name="share-social-outline" onPress={handleShare} accessibilityLabel="共有" /> : null}
          </>
        }
      />

      <ScrollView contentContainerStyle={styles.content}>
        {event ? (
          <Pressable onPress={copyKeyword} style={styles.keywordChip}>
            <Muted>合言葉: </Muted>
            <Muted style={{ color: colors.foreground, fontWeight: "700" }}>{event.keyword}</Muted>
            <Ionicons name="copy-outline" size={13} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

        {/* Members */}
        {memberList.length > 0 && (
          <View style={styles.membersRow}>
            <Ionicons name="people-outline" size={16} color={colors.mutedForeground} />
            {memberList.map((m) => (
              <Badge key={m.id} tone="secondary">
                {m.name}
              </Badge>
            ))}
          </View>
        )}

        {/* Tabs */}
        <View style={[styles.tabs, { backgroundColor: colors.muted }]}>
          <TabButton label="支払い一覧" icon="receipt-outline" active={tab === "payments"} onPress={() => setTab("payments")} />
          <TabButton label="精算結果" icon="wallet-outline" active={tab === "settlement"} onPress={() => setTab("settlement")} />
        </View>

        {tab === "payments" ? (
          <View style={{ gap: 12 }}>
            {!settled && (
              <Button
                title="支払いを追加"
                icon="add-circle-outline"
                onPress={() => {
                  setEditingPayment(null);
                  setPaymentModalOpen(true);
                }}
              />
            )}

            {paymentList.length > 0 && (
              <View style={styles.summaryRow}>
                <Muted>支払い {paymentList.length} 件</Muted>
                <Muted>
                  合計 <Muted style={{ color: colors.foreground, fontWeight: "700" }}>{formatYen(totalSpent)}</Muted>
                </Muted>
              </View>
            )}

            {paymentList.length === 0 ? (
              <Card style={styles.empty}>
                <Ionicons name="receipt-outline" size={36} color={colors.mutedForeground} />
                <Body style={{ fontWeight: "600" }}>まだ支払いがありません</Body>
                <Muted>「支払いを追加」ボタンで記録を始めましょう</Muted>
              </Card>
            ) : (
              sortedPayments.map((p) => {
                const splitIds: number[] = JSON.parse(p.splitMemberIds);
                const isAllMembers = splitIds.length === memberList.length;
                const mode = (p.splitMode ?? "equal") as SplitMode;
                return (
                  <Card key={p.id} style={styles.paymentCard}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.paymentTop}>
                        <Body style={{ fontWeight: "700" }}>{formatYen(p.amount)}</Body>
                        <Muted>← {getMemberName(p.payerId)}</Muted>
                        {mode !== "equal" && <Badge tone="outline">{SPLIT_MODE_LABEL[mode]}</Badge>}
                      </View>
                      <Body>{p.description}</Body>
                      <Muted>
                        {isAllMembers && mode === "equal"
                          ? "全員で割り勘"
                          : `${splitIds.map((id) => getMemberName(id)).join("、")} で割り勘`}
                      </Muted>
                    </View>
                    {!settled && (
                      <View style={{ gap: 4 }}>
                        <IconButton
                          name="pencil"
                          size={18}
                          color={colors.mutedForeground}
                          onPress={() => {
                            setEditingPayment(p);
                            setPaymentModalOpen(true);
                          }}
                          accessibilityLabel="支払いを編集"
                        />
                        <IconButton
                          name="trash-outline"
                          size={18}
                          color={colors.mutedForeground}
                          onPress={() => confirmDeletePayment(p)}
                          accessibilityLabel="支払いを削除"
                        />
                      </View>
                    )}
                  </Card>
                );
              })
            )}
          </View>
        ) : (
          <View style={{ gap: 16 }}>
            {paymentList.length === 0 ? (
              <Card style={styles.empty}>
                <Ionicons name="wallet-outline" size={36} color={colors.mutedForeground} />
                <Body style={{ fontWeight: "600" }}>支払いを追加してください</Body>
                <Muted>支払いを記録すると精算結果が表示されます</Muted>
              </Card>
            ) : (
              <>
                <View style={styles.statsRow}>
                  <Stat label="総支出" value={formatYen(totalSpent)} />
                  <Stat label="件数" value={String(paymentList.length)} />
                  <Stat label="1人平均" value={formatYen(perPersonAvg)} />
                </View>

                {settlement && memberList.length > 0 && (
                  <Card style={{ gap: 12 }}>
                    <View>
                      <Title style={{ fontSize: 14 }}>各自の収支</Title>
                      <Muted>プラスは受け取り、マイナスは支払い</Muted>
                    </View>
                    {memberList.map((m) => (
                      <BalanceBar
                        key={m.id}
                        name={m.name}
                        balance={Math.round(settlement.balances[m.id] ?? 0)}
                        max={maxAbsBalance}
                      />
                    ))}
                  </Card>
                )}

                {settlement?.transfers.length === 0 ? (
                  <Card style={styles.empty}>
                    <Ionicons name="checkmark-circle" size={32} color={colors.primary} />
                    <Body style={{ fontWeight: "600" }}>精算不要！</Body>
                    <Muted>全員の収支はすでにバランスが取れています</Muted>
                  </Card>
                ) : (
                  <Card style={{ gap: 10 }}>
                    <View>
                      <Title style={{ fontSize: 14 }}>送金リスト</Title>
                      <Muted>最小の回数で精算できます</Muted>
                    </View>
                    {settlement?.transfers.map((t, i) => (
                      <View key={i} style={[styles.transfer, { backgroundColor: colors.muted }]}>
                        <Body style={{ fontWeight: "600" }}>{t.from}</Body>
                        <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                        <Body style={{ fontWeight: "600" }}>{t.to}</Body>
                        <Body style={{ marginLeft: "auto", fontWeight: "700", color: colors.primary }}>
                          {formatYen(t.amount)}
                        </Body>
                      </View>
                    ))}
                  </Card>
                )}

                <Button title="精算結果をコピー" variant="outline" icon="clipboard-outline" onPress={copySummary} />

                {!settled ? (
                  <Button
                    title={settleMutation.isPending ? "精算中..." : "精算する"}
                    variant="outline"
                    icon="checkmark-circle-outline"
                    onPress={confirmSettle}
                    loading={settleMutation.isPending}
                  />
                ) : (
                  <Card style={styles.settledCard}>
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                    <View>
                      <Body style={{ fontWeight: "600" }}>精算済み</Body>
                      <Muted>このイベントは精算が完了しています</Muted>
                    </View>
                  </Card>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <PaymentModal
        visible={paymentModalOpen}
        onClose={() => {
          setPaymentModalOpen(false);
          setEditingPayment(null);
        }}
        eventId={eventId}
        members={memberList}
        payment={editingPayment}
      />
    </SafeAreaView>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabBtn, active && { backgroundColor: colors.card }]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.foreground : colors.mutedForeground} />
      <Body style={{ color: active ? colors.foreground : colors.mutedForeground, fontWeight: active ? "600" : "400" }}>
        {label}
      </Body>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.stat}>
      <Muted style={{ fontSize: 10 }}>{label}</Muted>
      <Body style={{ fontWeight: "700" }}>{value}</Body>
    </Card>
  );
}

function BalanceBar({ name, balance, max }: { name: string; balance: number; max: number }) {
  const { colors } = useTheme();
  const pct = max > 0 ? Math.min(100, (Math.abs(balance) / max) * 100) : 0;
  const positive = balance >= 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.balanceLabel}>
        <Body style={{ flexShrink: 1 }}>{name}</Body>
        <Body style={{ fontWeight: "700", color: positive ? colors.primary : colors.destructive }}>
          {formatSignedYen(balance)}
        </Body>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.muted }]}>
        <View style={styles.barHalf}>
          {!positive && (
            <View style={[styles.barFillLeft, { width: `${pct}%`, backgroundColor: colors.destructive }]} />
          )}
        </View>
        <View style={[styles.barHalf, { alignItems: "flex-start" }]}>
          {positive && (
            <View style={[styles.barFillRight, { width: `${pct}%`, backgroundColor: colors.primary }]} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", padding: 16 },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  keywordChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" },
  membersRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  tabs: { flexDirection: "row", borderRadius: 10, padding: 4, gap: 4 },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  empty: { alignItems: "center", gap: 6, paddingVertical: 32 },
  paymentCard: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  paymentTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  statsRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, alignItems: "center", gap: 2, padding: 12 },
  transfer: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
  settledCard: { flexDirection: "row", alignItems: "center", gap: 12 },
  balanceLabel: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  barTrack: { height: 8, borderRadius: 999, overflow: "hidden", flexDirection: "row" },
  barHalf: { width: "50%", flexDirection: "row", justifyContent: "flex-end" },
  barFillLeft: { height: "100%", borderTopLeftRadius: 999, borderBottomLeftRadius: 999 },
  barFillRight: { height: "100%", borderTopRightRadius: 999, borderBottomRightRadius: 999 },
});
