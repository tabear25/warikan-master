import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation } from "@tanstack/react-query";
import { apiJson } from "@/api/client";
import { useToast } from "@/components/Toast";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button, Card, Field, IconButton, Muted, Title } from "@/components/ui";
import { useTheme } from "@/theme";
import { LIMITS, type Event, type Member } from "@/lib/types";
import type { ScreenProps } from "@/navigation/types";

export default function CreateEventScreen({ navigation }: ScreenProps<"Create">) {
  const { colors } = useTheme();
  const { toast } = useToast();

  const [eventName, setEventName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [memberNames, setMemberNames] = useState<string[]>(["", ""]);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; keyword: string; memberNames: string[] }) =>
      apiJson<{ event: Event; members: Member[] }>("POST", "/api/events", data),
    onSuccess: (data) => {
      toast({ title: "イベントを作成しました🎉", description: `「${data.event.name}」が作成されました` });
      navigation.replace("Event", { eventId: data.event.id });
    },
    onError: (err: Error) => {
      const msg = err.message.includes("409") ? "その合言葉はすでに使われています" : err.message;
      toast({ title: "エラー", description: msg, variant: "destructive" });
    },
  });

  const addMember = () => setMemberNames((prev) => [...prev, ""]);
  const removeMember = (index: number) =>
    setMemberNames((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  const updateMember = (index: number, value: string) =>
    setMemberNames((prev) => prev.map((n, i) => (i === index ? value : n)));

  const handleSubmit = () => {
    const validNames = memberNames.map((n) => n.trim()).filter((n) => n.length > 0);
    if (validNames.length < 2) {
      toast({ title: "メンバーが足りません", description: "メンバーは2人以上入力してください", variant: "destructive" });
      return;
    }
    if (new Set(validNames).size !== validNames.length) {
      toast({ title: "メンバー名が重複しています", description: "同じ名前のメンバーは登録できません", variant: "destructive" });
      return;
    }
    if (!eventName.trim() || !keyword.trim()) {
      toast({ title: "入力が不完全です", description: "イベント名と合言葉を入力してください", variant: "destructive" });
      return;
    }
    createMutation.mutate({ name: eventName.trim(), keyword: keyword.trim(), memberNames: validNames });
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top"]}>
      <ScreenHeader title="イベント作成" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Title>イベント情報</Title>
            <Muted>イベントを設定します</Muted>
          </View>
          <Field
            label="イベント名 *"
            placeholder="例：京都旅行2026"
            value={eventName}
            onChangeText={setEventName}
            maxLength={LIMITS.eventName}
            editable={!createMutation.isPending}
          />
          <Field
            label="合言葉 *"
            placeholder="例：kyoto2026"
            value={keyword}
            onChangeText={setKeyword}
            maxLength={LIMITS.keyword}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!createMutation.isPending}
            hint="メンバーはこの合言葉でイベントに参加します"
          />
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Title>メンバー</Title>
            <Muted>参加するメンバーの名前を入力してください（2人以上）</Muted>
          </View>
          {memberNames.map((name, index) => (
            <View key={index} style={styles.memberRow}>
              <View style={[styles.indexBadge, { backgroundColor: colors.muted }]}>
                <Muted style={{ color: colors.primary, fontWeight: "700" }}>{index + 1}</Muted>
              </View>
              <Field
                style={styles.memberField}
                placeholder={`メンバー ${index + 1}`}
                value={name}
                onChangeText={(v) => updateMember(index, v)}
                maxLength={LIMITS.memberName}
                editable={!createMutation.isPending}
              />
              <IconButton
                name="trash-outline"
                onPress={() => removeMember(index)}
                disabled={memberNames.length <= 2 || createMutation.isPending}
                color={colors.mutedForeground}
                accessibilityLabel="メンバーを削除"
              />
            </View>
          ))}
          <Button
            title="メンバーを追加"
            variant="outline"
            icon="add"
            onPress={addMember}
            disabled={createMutation.isPending}
          />
        </Card>

        <Button
          title={createMutation.isPending ? "作成中..." : "イベントを作成する"}
          icon={createMutation.isPending ? undefined : "chevron-forward"}
          onPress={handleSubmit}
          loading={createMutation.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  card: { gap: 14 },
  cardHead: { gap: 4 },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  indexBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  memberField: { flex: 1 },
});
