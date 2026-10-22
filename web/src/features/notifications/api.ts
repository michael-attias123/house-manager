import { supabase, unwrap } from '@/lib/supabase'
import type { NotificationPrefs } from '@/lib/db-types'
import type { PrefKey } from './lib/prefs'
import type { PushSubscriptionInput } from './lib/push'

// Tables and RPCs in supabase/migrations/20261022000100_notifications.sql.

const MESSAGES: Record<string, string> = {
  'no push subscription': 'הטלפון הזה עוד לא רשום להתראות.',
  'invalid subscription': 'הדפדפן החזיר הרשמה לא תקינה. כדאי לנסות שוב.',
}

function hebrew(message: string): string {
  return MESSAGES[message] ?? message
}

export async function fetchPrefs(userId: string): Promise<NotificationPrefs | null> {
  const rows = unwrap(
    await supabase.from('notification_prefs').select('*').eq('user_id', userId),
  ) as NotificationPrefs[]
  return rows[0] ?? null
}

/** Upserts one column; the others keep their value (or the default, off). */
export async function savePref(userId: string, key: PrefKey, value: boolean): Promise<void> {
  unwrap(await supabase.from('notification_prefs').upsert({ user_id: userId, [key]: value }))
}

/** Whether the server has this device for the signed-in user (RLS shows only their own). */
export async function isDeviceSaved(endpoint: string): Promise<boolean> {
  const rows = unwrap(
    await supabase.from('push_subscriptions').select('id').eq('endpoint', endpoint),
  ) as { id: string }[]
  return rows.length > 0
}

export async function saveDevice(row: PushSubscriptionInput): Promise<void> {
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: row.endpoint,
    p_p256dh: row.p256dh,
    p_auth: row.auth,
    p_user_agent: row.user_agent,
  })
  if (error) throw new Error(hebrew(error.message))
}

export async function deleteDevice(endpoint: string): Promise<void> {
  unwrap(await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint))
}

/** Queues a test notification for all the caller's devices. */
export async function sendTestNotification(): Promise<void> {
  const { error } = await supabase.rpc('send_test_notification')
  if (error) throw new Error(hebrew(error.message))
}
