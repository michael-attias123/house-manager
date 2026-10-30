import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Venue, VenueDeal } from '@/lib/db-types'
import { useRealtimeInvalidate } from '@/lib/realtime'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { addDeal, addVenue, confirmDeal, deleteDeal, fetchDeals, fetchVenues, updateDeal, type NewVenue } from './api'
import type { DealFields } from './lib/draft'
import { BEER_SHEVA, inBeerSheva, type LatLng } from './lib/geo'

const DEMO = import.meta.env.VITE_DEMO === '1'

// What RLS returns depends on the household, so the keys carry it.
export const goingOutKeys = {
  venues: (householdId: string) => ['venues', householdId] as const,
  deals: (householdId: string) => ['venue-deals', householdId] as const,
}

export function useVenues() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: goingOutKeys.venues(household.id),
    queryFn: fetchVenues,
    staleTime: 10 * 60_000,
  })
}

/** Deals; the household's own suggestions (and their approval) arrive live. */
export function useDeals() {
  const { household } = useHousehold()
  useRealtimeInvalidate('venue_deals', household.id, [goingOutKeys.deals(household.id)])
  return useQuery({
    queryKey: goingOutKeys.deals(household.id),
    queryFn: fetchDeals,
    staleTime: 60_000,
  })
}

/** Optimistically applies `apply` to the cached deals; rolls back on error. */
function useOptimisticDeals<TVars>(
  mutationFn: (vars: TVars) => Promise<void>,
  apply: (deals: VenueDeal[], vars: TVars) => VenueDeal[],
) {
  const { household } = useHousehold()
  const queryClient = useQueryClient()
  const key = goingOutKeys.deals(household.id)
  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<VenueDeal[]>(key)
      queryClient.setQueryData<VenueDeal[]>(key, (deals = []) => apply(deals, vars))
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useAddDeal() {
  const { household, user } = useHousehold()
  return useOptimisticDeals<DealFields & { id: string }>(
    (fields) => addDeal({ ...fields, household_id: household.id, created_by: user.id }),
    (deals, fields) => {
      const now = new Date().toISOString()
      return [
        ...deals,
        {
          ...fields,
          household_id: household.id,
          created_by: user.id,
          status: 'pending',
          reviewed_by: null,
          reviewed_at: null,
          review_note: null,
          last_confirmed_at: now,
          created_at: now,
        },
      ]
    },
  )
}

export function useUpdateDeal() {
  return useOptimisticDeals<{ id: string; fields: DealFields }>(
    ({ id, fields }) => updateDeal(id, fields),
    (deals, { id, fields }) => deals.map((d) => (d.id === id ? { ...d, ...fields } : d)),
  )
}

export function useDeleteDeal() {
  return useOptimisticDeals<string>(
    (id) => deleteDeal(id),
    (deals, id) => deals.filter((d) => d.id !== id),
  )
}

export function useConfirmDeal() {
  return useOptimisticDeals<string>(
    (id) => confirmDeal(id),
    (deals, id) => deals.map((d) => (d.id === id ? { ...d, last_confirmed_at: new Date().toISOString() } : d)),
  )
}

/** Saves a place the household adds; resolves to the saved row (its id comes from the server). */
export function useAddVenue() {
  const { household, user } = useHousehold()
  const queryClient = useQueryClient()
  const key = goingOutKeys.venues(household.id)
  return useMutation({
    mutationFn: (venue: Omit<NewVenue, 'household_id' | 'created_by'>) =>
      addVenue({ ...venue, household_id: household.id, created_by: user.id }),
    onSuccess: (venue: Venue) => {
      queryClient.setQueryData<Venue[]>(key, (venues = []) => [...venues, venue])
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

/** The time, ticking every minute, so "now" and "later" move on by themselves. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

export type LocationState = 'idle' | 'asking' | 'granted' | 'denied' | 'outside' | 'error'

interface Fix {
  state: LocationState
  /** Only inside Be'er Sheva; never stored anywhere but this variable. */
  position: LatLng | null
}

export interface LocationValue extends Fix {
  /** Where distances are measured from: the phone, or the city center. */
  origin: LatLng
  /** Asks the browser (the permission prompt, the first time). */
  request: () => void
}

// The last fix, in memory only (no storage, no server), so moving between
// pages doesn't ask again.
let lastFix: Fix | null = null
const DEMO_FIX: Fix = { state: 'granted', position: BEER_SHEVA.center }
const REFRESH_MS = 2 * 60_000

/**
 * The phone's location for distances. Asked for only through `request`
 * (the "לפי המיקום שלי" button), or by itself when the permission was
 * already granted. The demo stands at the city center.
 */
export function useLocation(): LocationValue {
  const [fix, setFix] = useState<Fix>(() => (DEMO ? DEMO_FIX : (lastFix ?? { state: 'idle', position: null })))

  const locate = useCallback(() => {
    if (DEMO) return
    const update = (next: Fix) => {
      lastFix = next
      setFix(next)
    }
    if (!('geolocation' in navigator)) {
      update({ state: 'error', position: null })
      return
    }
    // A refresh keeps showing the current fix meanwhile.
    setFix((f) => (f.state === 'granted' || f.state === 'outside' ? f : { state: 'asking', position: null }))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        update(inBeerSheva(p) ? { state: 'granted', position: p } : { state: 'outside', position: null })
      },
      (err) => update({ state: err.code === err.PERMISSION_DENIED ? 'denied' : 'error', position: null }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    )
  }, [])

  // Without asking: only when the browser says the permission is already there.
  useEffect(() => {
    if (DEMO || !navigator.permissions) return
    let cancelled = false
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === 'granted') locate()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [locate])

  // Every two minutes while the page is in view.
  const tracking = fix.state === 'granted' || fix.state === 'outside'
  useEffect(() => {
    if (DEMO || !tracking) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') locate()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [tracking, locate])

  return { ...fix, origin: fix.position ?? BEER_SHEVA.center, request: locate }
}
