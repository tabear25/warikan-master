import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, ThemeColors } from "@/theme";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// ---------------------------------------------------------------------------
// Logo — a circular ¥ mark echoing the web app's WaricanLogo.
// ---------------------------------------------------------------------------
export function Logo({ size = 32 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: colors.primary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: colors.primary, fontWeight: "800", fontSize: size * 0.5 }}>¥</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Icon button (header actions)
// ---------------------------------------------------------------------------
export function IconButton({
  name,
  onPress,
  color,
  size = 22,
  accessibilityLabel,
  disabled,
}: {
  name: IoniconName;
  onPress?: () => void;
  color?: string;
  size?: number;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        { padding: 6, borderRadius: 8, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={name} size={size} color={color ?? colors.foreground} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IoniconName;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.primary, fg: colors.primaryForeground, border: colors.primary },
    outline: { bg: "transparent", fg: colors.foreground, border: colors.input },
    ghost: { bg: "transparent", fg: colors.foreground, border: "transparent" },
    destructive: { bg: colors.destructive, fg: colors.destructiveForeground, border: colors.destructive },
  };
  const p = palette[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: p.bg, borderColor: p.border, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} size="small" />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={18} color={p.fg} /> : null}
          <Text style={[styles.buttonText, { color: p.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.cardBorder },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Text helpers (themed)
// ---------------------------------------------------------------------------
export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return <Text style={[styles.title, { color: colors.foreground }, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return <Text style={[styles.muted, { color: colors.mutedForeground }, style]}>{children}</Text>;
}

export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: colors.foreground }, style]}>{children}</Text>;
}

// ---------------------------------------------------------------------------
// Labeled text field
// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  style,
  ...inputProps
}: {
  label?: string;
  hint?: string;
  // `style` sizes the field container (e.g. flex / width). The inner TextInput
  // styling is handled internally, so we drop TextInput's own `style`.
  style?: StyleProp<ViewStyle>;
} & Omit<TextInputProps, "style">) {
  const { colors } = useTheme();
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        {...inputProps}
        style={[
          styles.input,
          { borderColor: colors.input, color: colors.foreground, backgroundColor: colors.background },
        ]}
      />
      {hint ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
export function Badge({
  children,
  tone = "secondary",
}: {
  children: React.ReactNode;
  tone?: "secondary" | "outline" | "primary";
}) {
  const { colors } = useTheme();
  const map = {
    secondary: { bg: colors.secondary, fg: colors.secondaryForeground, border: colors.secondary },
    outline: { bg: "transparent", fg: colors.mutedForeground, border: colors.border },
    primary: { bg: colors.primary, fg: colors.primaryForeground, border: colors.primary },
  } as const;
  const m = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: m.bg, borderColor: m.border }]}>
      <Text style={[styles.badgeText, { color: m.fg }]}>{children}</Text>
    </View>
  );
}

export function makeStyles(_colors: ThemeColors) {
  return styles;
}

const styles = StyleSheet.create({
  button: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  card: { borderRadius: 12, borderWidth: 1, padding: 16 },
  title: { fontSize: 16, fontWeight: "700" },
  muted: { fontSize: 13 },
  body: { fontSize: 14 },
  label: { fontSize: 13, fontWeight: "500" },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  hint: { fontSize: 12 },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
});
