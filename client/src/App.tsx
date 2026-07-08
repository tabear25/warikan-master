import { lazy, Suspense } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { MotionConfig } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ErrorBoundary } from "@/components/error-boundary";

// ルート単位のコード分割。特に event ページは html-to-image / qrcode /
// recharts を抱えており、初回ロードのバンドルから外す効果が大きい。
const Home = lazy(() => import("@/pages/home"));
const CreateEvent = lazy(() => import("@/pages/create-event"));
const EventPage = lazy(() => import("@/pages/event"));
const AdminPage = lazy(() => import("@/pages/admin"));
const Help = lazy(() => import("@/pages/help"));
const NotFound = lazy(() => import("@/pages/not-found"));

function AppRouter() {
  return (
    <Suspense fallback={null}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/create" component={CreateEvent} />
        <Route path="/event/:id" component={EventPage} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/help" component={Help} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <Toaster />
            {/* ErrorBoundary を Suspense の外に置き、チャンク読込失敗も捕捉する */}
            <ErrorBoundary>
              <Router hook={useHashLocation}>
                <AppRouter />
              </Router>
            </ErrorBoundary>
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
