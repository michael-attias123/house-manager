import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})

// The cache is kept in localStorage so the app opens with data even offline
// (e.g. inside a supermarket with no reception).
function browserStorage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    // Blocked (private mode, sandboxed frames): run without the offline cache.
    return undefined
  }
}

export const persister = createSyncStoragePersister({
  storage: browserStorage(),
  key: 'house-manager-cache',
})
