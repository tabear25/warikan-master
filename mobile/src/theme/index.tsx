import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Color tokens ported from `client/src/index.css`. React Native accepts
// `hsl(h, s%, l%)` color strings, so we reuse the exact CSS variable values.
export interface ThemeColors {
  background: string;
  foreground: string;
  border: string;
  card: string;
  cardBorder: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  destructive: string;
  destructiveForeground: string;
  input: string;
}

const light: ThemeColors = {
  background: "hsl(140, 15%, 97%)",
  foreground: "hsl(150, 10%, 10%)",
  border: "hsl(140, 10%, 88%)",
  card: "hsl(140, 15%, 99%)",
  cardBorder: "hsl(140, 10%, 92%)",
  primary: "hsl(158, 55%, 38%)",
  primaryForeground: "hsl(0, 0%, 100%)",
  secondary: "hsl(140, 12%, 92%)",
  secondaryForeground: "hsl(150, 10%, 15%)",
  muted: "hsl(140, 10%, 93%)",
  mutedForeground: "hsl(150, 5%, 45%)",
  accent: "hsl(140, 14%, 90%)",
  destructive: "hsl(0, 72%, 51%)",
  destructiveForeground: "hsl(0, 0%, 98%)",
  input: "hsl(140, 8%, 78%)",
};

const dark: ThemeColors = {
  background: "hsl(150, 10%, 7%)",
  foreground: "hsl(140, 5%, 95%)",
  border: "hsl(150, 6%, 18%)",
  card: "hsl(150, 8%, 10%)",
  cardBorder: "hsl(150, 6%, 14%)",
  primary: "hsl(158, 45%, 50%)",
  primaryForeground: "hsl(0, 0%, 100%)",
  secondary: "hsl(150, 8%, 18%)",
  secondaryForeground: "hsl(140, 5%, 90%)",
  muted: "hsl(150, 6%, 20%)",
  mutedForeground: "hsl(140, 5%, 60%)",
  accent: "hsl(150, 8%, 16%)",
  destructive: "hsl(0, 72%, 51%)",
  destructiveForeground: "hsl(0, 0%, 98%)",
  input: "hsl(150, 5%, 28%)",
};

export type ThemeName = "light" | "dark";

interface ThemeContextValue {
  theme: ThemeName;
  colors: ThemeColors;
  toggleTheme: () => void;
}

const STORAGE_KEY = "warikan.theme";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<ThemeName | null>(null);

  // Restore a previously chosen theme (if the user toggled before).
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (value === "light" || value === "dark") setOverride(value);
      })
      .catch(() => {});
  }, []);

  const theme: ThemeName = override ?? (systemScheme === "dark" ? "dark" : "light");

  const toggleTheme = useCallback(() => {
    setOverride((prev) => {
      const current = prev ?? (systemScheme === "dark" ? "dark" : "light");
      const next: ThemeName = current === "dark" ? "light" : "dark";
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, [systemScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, colors: theme === "dark" ? dark : light, toggleTheme }),
    [theme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
