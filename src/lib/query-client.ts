// The single TanStack Query client used for all server state.
//
// Exported as a module-level singleton (rather than created per component) so
// the sync engine can drive it imperatively while components read the same
// cache reactively.

import { QueryClient } from "@tanstack/vue-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Synced state is owned by the server; never serve it stale.
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: 1,
      // Refresh is driven explicitly by the sync engine.
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Writes are idempotent-ish but a blind retry could clobber a newer
      // revision, so failures are surfaced instead of retried automatically.
      retry: 0,
    },
  },
});
