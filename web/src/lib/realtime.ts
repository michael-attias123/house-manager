import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface SharedChannel {
  channel: RealtimeChannel
  listeners: Set<() => void>
}

// One channel per table and household, shared by every component that
// listens to it (supabase-js rejects adding listeners to a joined channel).
const channels = new Map<string, SharedChannel>()
let sequence = 0

function listen(table: string, householdId: string, listener: () => void): () => void {
  const key = `${table}:${householdId}`
  let shared = channels.get(key)
  if (!shared) {
    const listeners = new Set<() => void>()
    // A unique topic, so a channel still closing never gets reused.
    const channel = supabase
      .channel(`${key}:${++sequence}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, () =>
        listeners.forEach((l) => l()),
      )
      .subscribe()
    shared = { channel, listeners }
    channels.set(key, shared)
  }
  const entry = shared
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0 && channels.get(key) === entry) {
      channels.delete(key)
      void supabase.removeChannel(entry.channel)
    }
  }
}

/** Re-fetches the given queries whenever rows of `table` change for this household. */
export function useRealtimeInvalidate(table: string, householdId: string | undefined, queryKeys: QueryKey[]) {
  const queryClient = useQueryClient()
  const keys = JSON.stringify(queryKeys)

  useEffect(() => {
    if (!householdId) return
    return listen(table, householdId, () => {
      for (const key of JSON.parse(keys) as QueryKey[]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    })
  }, [table, householdId, keys, queryClient])
}
