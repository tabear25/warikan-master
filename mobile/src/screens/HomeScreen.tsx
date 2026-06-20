import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation } from "@tanstack/react-query";
import { apiJson } from "@/api/client";
import { useToast } from "@/components/Toast";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button, Card, Field, IconButton, Logo, Muted, Title } from "@/components/ui";
import { useTheme } from "@/theme";
import type { Event, Member } from "@/lib/types";
import type { ScreenProps } from "@/navigation/types";

export default function HomeScreen({ navigation }: ScreenProps<"Home">) {
  const { colors } = useTheme();
  const { toast } = useToast();
  const [keyword, setKeyword] = useState("");

  const joinMutation = useMutation({
    mutationFn: (kw: string) =>
      apiJson<{ event: Event; members: Member[] }>("POST", "/api/events/join", { keyword: kw }),
    onSuccess: (data) => {
      navigation.navigate("Event", { eventId: data.event.id });
    },
    onError: (err: Error) => {
      toast({
        title: "イベントが見つかりません",
        description: err.message.includes("404") ? "合言葉が間違っています" : err.message,
        variant: "destructive",
      });
    },
  });

  const handleJoin = () => {
    const kw = keyword.trim();
    if (!kw) return;
    joinMutation.mutate(kw);
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top"]}>
      <ScreenHeader
        title="Warikan Master"
        right={
          <IconButton
            name="help-circle-outline"
            onPress={() => navigation.navigate("Help")}
            accessibilityLabel="ヘルプ"
          />
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Logo size={64} />
          <Title style={styles.heroTitle}>割り勘マスター</Title>
          <Muted style={styles.heroSub}>
            旅行・食事の割り勘をかんたんに。{"\n"}合言葉でグループに参加しましょう。
          </Muted>
        </View>

        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Title>イベントに参加する</Title>
            <Muted>合言葉を入力してイベントに参加します</Muted>
          </View>
          <Field
            label="合言葉"
            placeholder="例：osaka2024"
            value={keyword}
            onChangeText={setKeyword}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!joinMutation.isPending}
            onSubmitEditing={handleJoin}
            returnKeyType="go"
          />
          <Button
            title={joinMutation.isPending ? "参加中..." : "参加する"}
            onPress={handleJoin}
            loading={joinMutation.isPending}
            disabled={!keyword.trim()}
          />
        </Card>

        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Title>新しいイベントを作成する</Title>
            <Muted>旅行や食事のイベントを作って、みんなを招待しましょう</Muted>
          </View>
          <Button
            title="イベントを作る"
            variant="outline"
            icon="people-outline"
            onPress={() => navigation.navigate("Create")}
          />
        </Card>

        <Pressable onPress={() => navigation.navigate("Admin")} style={styles.adminLink}>
          <Text style={[styles.adminText, { color: colors.mutedForeground }]}>管理者ログイン</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  hero: { alignItems: "center", marginTop: 16, marginBottom: 8, gap: 8 },
  heroTitle: { fontSize: 20, marginTop: 8 },
  heroSub: { textAlign: "center", lineHeight: 20 },
  card: { gap: 14 },
  cardHead: { gap: 4 },
  adminLink: { alignItems: "center", paddingVertical: 8 },
  adminText: { fontSize: 12, textDecorationLine: "underline" },
});
