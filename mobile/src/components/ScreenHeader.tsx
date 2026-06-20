import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/theme";
import { IconButton, Logo } from "@/components/ui";

// Top bar matching the web app's header: optional back button, logo + title on
// the left, a theme toggle plus any extra actions on the right.
export function ScreenHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}) {
  const { colors, theme, toggleTheme } = useTheme();
  return (
    <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <View style={styles.side}>
        {onBack ? (
          <IconButton name="arrow-back" onPress={onBack} accessibilityLabel="戻る" />
        ) : null}
        <Logo size={28} />
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={styles.actions}>
        {right}
        <IconButton
          name={theme === "dark" ? "sunny-outline" : "moon-outline"}
          onPress={toggleTheme}
          accessibilityLabel="テーマ切り替え"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  side: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", alignItems: "center", gap: 2 },
  title: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
});
