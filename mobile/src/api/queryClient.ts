import { QueryClient } from "@tanstack/react-query";

// Matches the web client's defaults: no refetch churn, errors surface to the UI.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
