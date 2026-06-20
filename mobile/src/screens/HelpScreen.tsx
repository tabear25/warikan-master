import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Card, Muted, Title } from "@/components/ui";
import { useTheme } from "@/theme";
import type { ScreenProps } from "@/navigation/types";

const faqs: { question: string; answer: string }[] = [
  {
    question: "合言葉とは何ですか？",
    answer:
      "グループに参加するための共有キーワードです。イベントの作成者は、イベント作成時に決めて、参加するメンバーに伝えてください（例：osaka2024）。",
  },
  {
    question: "合言葉を確認したい／忘れた",
    answer:
      "イベント画面の上部に合言葉が表示され、タップでコピーできます。変更はできないため、変えたい場合は新しいイベントを作成してください。",
  },
  {
    question: "メンバーを後から追加できますか？",
    answer:
      "できます。イベント画面のメンバー一覧の横にある「追加」から、精算前であればいつでもメンバーを追加できます。",
  },
  {
    question: "支払い金額を間違えて入力してしまいました",
    answer:
      "イベント画面の支払い一覧で、各支払いの鉛筆アイコンから編集、ゴミ箱アイコンから削除できます（精算前のみ）。",
  },
  {
    question: "割り勘を均等以外にできますか？",
    answer:
      "支払い追加・編集の画面で「均等／比率／金額指定」を選べます。比率は重み（例：2:1:1）、金額指定は一人ずつの金額を入力します。端数は1円単位で自動調整され、合計はぴったり一致します。",
  },
  {
    question: "精算結果を共有したい",
    answer:
      "精算結果タブの下部から、テキストをコピーして共有できます。合言葉を伝えれば、ほかのメンバーも同じイベントに参加できます。",
  },
  {
    question: "ダークモードに切り替えたい",
    answer: "画面右上の月／太陽アイコンを押すと、ダークモードとライトモードを切り替えられます。",
  },
];

export default function HelpScreen({ navigation }: ScreenProps<"Help">) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]} edges={["top"]}>
      <ScreenHeader title="ヘルプ" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Ionicons name="help-circle-outline" size={40} color={colors.primary} />
          <Title style={styles.introTitle}>よくある質問</Title>
          <Muted style={styles.introSub}>はじめてご利用の方向けのトラブルシューティングです。</Muted>
        </View>
        {faqs.map((faq, i) => (
          <Card key={i} style={styles.card}>
            <Title style={styles.q}>{faq.question}</Title>
            <Muted style={styles.a}>{faq.answer}</Muted>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  intro: { alignItems: "center", gap: 6, marginBottom: 4 },
  introTitle: { fontSize: 18 },
  introSub: { textAlign: "center" },
  card: { gap: 8 },
  q: { fontSize: 14 },
  a: { lineHeight: 20 },
});
