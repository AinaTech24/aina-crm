/**
 * TanStack Query client — the app's server-cache + data layer. Conservative
 * defaults tuned for a CRM on mobile data: one retry, 30s freshness, no refetch
 * thrash on focus (manual pull-to-refresh instead).
 */

import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, err) => {
        // Don't retry auth/permission failures — only transient ones.
        if (err instanceof ApiError && [400, 401, 403, 404, 422].includes(err.status)) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: 0 },
  },
});
