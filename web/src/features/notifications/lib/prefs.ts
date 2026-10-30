import type { NotificationPrefs } from '@/lib/db-types'

/** The columns of notification_prefs, in the order the card lists them. */
export const PREF_KEYS = ['bills', 'chores', 'partner', 'weekly', 'going_out', 'admin'] as const
export type PrefKey = (typeof PREF_KEYS)[number]

export const PREF_TITLES: Record<PrefKey, string> = {
  bills: 'חשבונות',
  chores: 'מטלות',
  partner: 'פעולות של בן/בת הזוג',
  weekly: 'סיכום שבועי',
  going_out: 'לאן יוצאים',
  admin: 'ניהול',
}

/** "ניהול" only means something to admins (enqueue_notification checks app_admins). */
export function prefKeysFor(isAdmin: boolean): PrefKey[] {
  return PREF_KEYS.filter((k) => k !== 'admin' || isAdmin)
}

/** No row yet means everything is off, like the column defaults. */
export function prefsOrDefault(
  row: NotificationPrefs | null | undefined,
  userId: string,
): NotificationPrefs {
  return (
    row ?? {
      user_id: userId,
      bills: false,
      chores: false,
      partner: false,
      weekly: false,
      going_out: false,
      admin: false,
    }
  )
}
