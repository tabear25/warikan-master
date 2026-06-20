import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

type ToastVariant = "default" | "destructive";

interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ToastOptions | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback(
    (options: ToastOptions) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setCurrent(options);
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(
          ({ finished }) => {
            if (finished) setCurrent(null);
          },
        );
      }, 2600);
    },
    [opacity],
  );

  const isDestructive = current?.variant === "destructive";

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {current ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrap,
            { bottom: insets.bottom + 24, opacity },
          ]}
        >
          <View
            style={[
              styles.toast,
              {
                backgroundColor: isDestructive ? colors.destructive : colors.card,
                borderColor: isDestructive ? colors.destructive : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.title,
                { color: isDestructive ? colors.destructiveForeground : colors.foreground },
              ]}
            >
              {current.title}
            </Text>
            {current.description ? (
              <Text
                style={[
                  styles.desc,
                  {
                    color: isDestructive ? colors.destructiveForeground : colors.mutedForeground,
                  },
                ]}
              >
                {current.description}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  title: { fontSize: 14, fontWeight: "700" },
  desc: { fontSize: 13, marginTop: 2 },
});
