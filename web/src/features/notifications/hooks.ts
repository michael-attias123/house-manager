import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useHousehold } from '@/features/household/HouseholdProvider'
import type { NotificationPrefs } from '@/lib/db-types'
import {
  deleteDevice,
  fetchPrefs,
  isDeviceSaved,
  saveDevice,
  savePref,
  sendTestNotification,
} from './api'
import { prefsOrDefault, type PrefKey } from './lib/prefs'
import { sameKey, subscriptionToRow, urlBase64ToUint8Array } from './lib/push'

/** From `npx web-push generate-vapid-keys` (docs/setup.md); without it push is off. */
export const VAPID_PUBLIC_KEY = String(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '').trim() || null

export const notificationKeys = {
  prefs: (userId: string) => ['notification-prefs', userId] as const,
  device: (userId: string) => ['notification-device', userId] as const,
}

export function useNotificationPrefs() {
  const { user } = useHousehold()
  return useQuery({ queryKey: notificationKeys.prefs(user.id), queryFn: () => fetchPrefs(user.id) })
}

/** Optimistic: the checkbox moves at once and moves back if saving fails. */
export function useSetPref() {
  const { user } = useHousehold()
  const queryClient = useQueryClient()
  const queryKey = notificationKeys.prefs(user.id)
  return useMutation({
    mutationFn: ({ key, value }: { key: PrefKey; value: boolean }) => savePref(user.id, key, value),
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<NotificationPrefs | null>(queryKey)
      queryClient.setQueryData<NotificationPrefs>(queryKey, {
        ...prefsOrDefault(previous, user.id),
        [key]: value,
      })
      return { previous }
    },
    onError: (_error, _vars, context) =>
      queryClient.setQueryData(queryKey, context?.previous ?? null),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}

export interface DeviceState {
  permission: NotificationPermission
  /**
   * This browser has a subscription made with the current VAPID key, and the
   * server has it for the signed-in user. Otherwise the card offers to turn
   * notifications on (again).
   */
  subscribed: boolean
}

async function readDevice(): Promise<DeviceState> {
  const permission = Notification.permission
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  const subscribed = Boolean(
    subscription &&
    permission === 'granted' &&
    VAPID_PUBLIC_KEY &&
    sameKey(subscription.options.applicationServerKey, urlBase64ToUint8Array(VAPID_PUBLIC_KEY)) &&
    (await isDeviceSaved(subscription.endpoint)),
  )
  return { permission, subscribed }
}

/** Only call where pushSupport() is 'ready'. */
export function usePushDevice(enabled: boolean) {
  const { user } = useHousehold()
  return useQuery({
    queryKey: notificationKeys.device(user.id),
    queryFn: readDevice,
    enabled,
    // Permission can change in the phone's settings while the app is in the background.
    staleTime: 0,
  })
}

function serviceWorkerReady(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('האפליקציה עוד נטענת. כדאי לנסות שוב בעוד רגע.')),
        timeoutMs,
      ),
    ),
  ])
}

/**
 * Takes the promise of Notification.requestPermission(), which the tap
 * handler must call itself: iOS shows the prompt only during the tap, and
 * the mutation starts a tick later.
 */
export function useEnablePush() {
  const { user } = useHousehold()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (permission: Promise<NotificationPermission>) => {
      if ((await permission) !== 'granted' || !VAPID_PUBLIC_KEY) return
      const registration = await serviceWorkerReady()
      const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      let subscription = await registration.pushManager.getSubscription()
      // Made with older VAPID keys: the push service would refuse our messages.
      if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
        await subscription.unsubscribe()
        subscription = null
      }
      subscription ??= await registration.pushManager
        .subscribe({ userVisibleOnly: true, applicationServerKey: key })
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`הרישום להתראות נכשל (${reason})`)
        })
      await saveDevice(subscriptionToRow(subscription, navigator.userAgent))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.device(user.id) }),
  })
}

/** Turns push off on this device only: the server row first, then the browser's subscription. */
export function useDisablePush() {
  const { user } = useHousehold()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (!subscription) return
      await deleteDevice(subscription.endpoint)
      await subscription.unsubscribe()
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.device(user.id) }),
  })
}

export function useSendTestNotification() {
  return useMutation({ mutationFn: sendTestNotification })
}
