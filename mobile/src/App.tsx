import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/api/queryClient";
import { ThemeProvider, useTheme } from "@/theme";
import { ToastProvider } from "@/components/Toast";
import type { RootStackParamList } from "@/navigation/types";
import HomeScreen from "@/screens/HomeScreen";
import CreateEventScreen from "@/screens/CreateEventScreen";
import EventScreen from "@/screens/EventScreen";
import AdminScreen from "@/screens/AdminScreen";
import HelpScreen from "@/screens/HelpScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

// Bridges our theme tokens into React Navigation's container theme (used for the
// background behind screens during transitions and the status bar style).
function Navigation() {
  const { theme, colors } = useTheme();
  const navTheme = {
    ...(theme === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme === "dark" ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card: colors.card,
      text: colors.foreground,
      border: colors.border,
      primary: colors.primary,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      {/* Headers are rendered per-screen (ScreenHeader), so disable the native one. */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Create" component={CreateEventScreen} />
        <Stack.Screen name="Event" component={EventScreen} />
        <Stack.Screen name="Admin" component={AdminScreen} />
        <Stack.Screen name="Help" component={HelpScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <Navigation />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
