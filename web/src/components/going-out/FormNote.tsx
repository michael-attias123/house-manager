import type { SuggestionStatus } from '@/lib/db-types'
import type { FormMode } from '@/features/going-out/lib/draft'

/** What saving the form does, when it's more than "saved". */
export function FormNote({ mode, status }: { mode: FormMode; status?: SuggestionStatus }) {
  const text =
    mode === 'create'
      ? 'נשמר לבית שלכם ונשלח לאישור. אחרי אישור יופיע לכולם.'
      : mode === 'admin'
        ? 'עריכת ניהול: השינויים מופיעים מיד, והסטטוס נשאר כמו שהוא.'
        : status === 'rejected'
          ? 'השמירה תשלח את ההצעה שוב לאישור.'
          : null
  if (!text) return null
  return <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">{text}</p>
}
