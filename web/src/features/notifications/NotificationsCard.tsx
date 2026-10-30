import { useState, type ReactNode } from 'react'
import { Bell, BellOff, Send } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { ErrorBox, Spinner } from '@/components/ui/Feedback'
import { useIsAdmin } from '@/features/admin/hooks'
import { useHousehold } from '@/features/household/HouseholdProvider'
import {
  useDisablePush,
  useEnablePush,
  useNotificationPrefs,
  usePushDevice,
  useSendTestNotification,
  useSetPref,
  VAPID_PUBLIC_KEY,
} from './hooks'
import { PREF_TITLES, prefKeysFor, prefsOrDefault, type PrefKey } from './lib/prefs'
import { pushSupport } from './lib/push'

const DEMO = import.meta.env.VITE_DEMO === '1'

const DESCRIPTIONS: Record<PrefKey, ReactNode> = {
  bills: (
    <>
      בבוקר, <span className="num">3</span> ימים לפני מועד תשלום וביום עצמו, וכשהוראת קבע נרשמת.
    </>
  ),
  chores: (
    <>
      בכל בוקר ב-<span className="num">08:00</span>: המטלות להיום שלך או של כולם.
    </>
  ),
  partner: 'הוצאה שיש לך חלק בה, העברה אליך או קנייה שהסתיימה, ברגע שנרשמו.',
  weekly: (
    <>
      ביום שישי ב-<span className="num">09:00</span>: כמה הוצאתם השבוע ומה היתרה.
    </>
  ),
  going_out: 'כשהצעה שלכם אושרה או נדחתה.',
  admin: 'כשטעינת המחירים נכשלת או מסתיימת רק בחלקה, וכשמגיעה הצעה חדשה ללאן יוצאים.',
}

/** Settings section: turning push on for this device, and choosing what to get. */
export default function NotificationsCard() {
  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <CardTitle>התראות</CardTitle>
        <p className="text-sm text-ink-2">
          תזכורות לחשבונות ולמטלות, ומה שנרשם בבית, גם בלי לפתוח את האפליקציה.
        </p>
      </div>
      {DEMO ? <DemoContent /> : <DeviceContent />}
    </Card>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">{children}</p>
}

function DemoContent() {
  return (
    <>
      <Note>התראות לא זמינות בדמו. הבחירה כאן נשמרת רק בדפדפן הזה.</Note>
      <Preferences />
    </>
  )
}

function DeviceContent() {
  const [support] = useState(() => pushSupport())
  const ready = support === 'ready' && VAPID_PUBLIC_KEY !== null
  const device = usePushDevice(ready)
  const enable = useEnablePush()
  const disable = useDisablePush()

  if (support === 'unsupported') return <Note>הטלפון או הדפדפן הזה לא תומכים בהתראות.</Note>
  if (support === 'ios-needs-install') {
    return (
      <Note>
        באייפון התראות עובדות רק מהאייקון במסך הבית: פותחים את האתר בספארי ← שיתוף ← הוספה למסך
        הבית, ונכנסים משם.
      </Note>
    )
  }
  if (!VAPID_PUBLIC_KEY) {
    return (
      <Note>
        התראות עוד לא הוגדרו (ההוראות ב-<code dir="ltr">docs/setup.md</code>).
      </Note>
    )
  }
  if (device.isPending) return <Spinner />
  if (device.error) return <ErrorBox error={device.error} />

  if (device.data.permission === 'denied') {
    return (
      <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
        <p className="font-medium text-ink">ההתראות חסומות בטלפון הזה.</p>
        <p>כדי לאפשר אותן:</p>
        <ul className="list-disc space-y-1 ps-5">
          <li>אייפון: הגדרות ← הודעות ← הבית ← אישור הודעות.</li>
          <li>אנדרואיד: לחיצה ארוכה על האייקון ← פרטי האפליקציה ← התראות.</li>
          <li>דפדפן במחשב: סמל המנעול ליד הכתובת ← התראות ← לאפשר.</li>
        </ul>
        <p>אחר כך חוזרים לכאן.</p>
      </div>
    )
  }

  if (!device.data.subscribed) {
    return (
      <div className="space-y-2">
        {/* requestPermission() is called right in the tap: iOS ignores it later. */}
        <Button
          className="w-full"
          onClick={() => enable.mutate(Notification.requestPermission())}
          disabled={enable.isPending}
        >
          <Bell size={18} />
          הפעלת התראות בטלפון הזה
        </Button>
        <p className="text-xs text-ink-3">
          אחרי ההפעלה בוחרים אילו התראות לקבל. עד אז כולן כבויות.
        </p>
        {enable.error && <ErrorBox error={enable.error} />}
      </div>
    )
  }

  return (
    <>
      <p className="flex items-center gap-2 text-sm font-medium text-brand-700">
        <Bell size={16} />
        הטלפון הזה מקבל התראות
      </p>
      <Preferences />
      <Button
        variant="ghost"
        className="w-full"
        onClick={() => disable.mutate()}
        disabled={disable.isPending}
      >
        <BellOff size={18} />
        כיבוי בטלפון הזה
      </Button>
      {disable.error && <ErrorBox error={disable.error} />}
    </>
  )
}

function Preferences() {
  const { user } = useHousehold()
  const prefs = useNotificationPrefs()
  const setPref = useSetPref()
  const isAdmin = useIsAdmin()
  const test = useSendTestNotification()
  // The tapped value until the save settles: a controlled checkbox would
  // otherwise flick back for a frame before the cache catches up.
  const [saving, setSaving] = useState<Partial<Record<PrefKey, boolean>>>({})

  if (prefs.isPending) return <Spinner />
  if (prefs.error) return <ErrorBox error={prefs.error} />
  const current = { ...prefsOrDefault(prefs.data, user.id), ...saving }

  function toggle(key: PrefKey, value: boolean) {
    setSaving((s) => ({ ...s, [key]: value }))
    // mutateAsync settles for every call (mutate's own callbacks only for the
    // last one). A failure is shown below, and the cache is rolled back.
    setPref
      .mutateAsync({ key, value })
      .catch(() => undefined)
      .finally(() =>
        setSaving((s) => {
          const rest = { ...s }
          delete rest[key]
          return rest
        }),
      )
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {prefKeysFor(isAdmin.data === true).map((key) => (
          <li key={key}>
            <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
              <input
                type="checkbox"
                checked={current[key]}
                onChange={(e) => toggle(key, e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-brand-700"
              />
              <span className="text-sm">
                <span className="font-medium text-ink">{PREF_TITLES[key]}</span>
                <span className="block text-ink-3">{DESCRIPTIONS[key]}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {setPref.error && <ErrorBox error={setPref.error} />}
      <p className="text-xs text-ink-3">
        הבחירה חלה על כל המכשירים שלך. ההפעלה עצמה נעשית בכל טלפון בנפרד. בין{' '}
        <span className="num">22:00</span> ל-<span className="num">07:00</span> לא נשלחות התראות,
        ומה שקרה בלילה מגיע ב-<span className="num">07:30</span>.
      </p>
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => test.mutate()}
        disabled={test.isPending}
      >
        <Send size={18} />
        {test.isSuccess ? 'נשלחה ✓' : 'שליחת התראת בדיקה'}
      </Button>
      {test.isSuccess && (
        <p className="text-xs text-ink-3">
          {DEMO ? 'בדמו לא מגיעה התראה.' : 'ההתראה אמורה להגיע לכל הטלפונים שלך תוך כמה שניות.'}
        </p>
      )}
      {test.error && <ErrorBox error={test.error} />}
    </div>
  )
}
