// Deals read from screenshots by an AI chat (Claude, or any other): the
// instructions to paste there, and its answer back as deal drafts. The chat
// does the image reading for free; the app only parses text, so nothing here
// calls a model or needs a key.
import type { DealKind, Venue } from '@/lib/db-types'
import type { ISODate } from '@/lib/dates'
import { emptyDraft, NOTE_MAX, type DealDraft } from './draft'
import { searchVenues } from './search'

/** One deal as the instructions ask for it. Anything may be missing or wrong. */
export interface AiDeal {
  place: string
  address: string | null
  title: string
  kind: DealKind
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  days: number[]
  from: string | null
  to: string | null
  /** An event's date. */
  date: ISODate | null
  /** The last day of a deal that ends. */
  until: ISODate | null
  note: string | null
}

const KINDS: DealKind[] = ['happy_hour', 'special_day', 'event', 'member_card']

/** What to paste into the chat, with the screenshots. */
export function aiInstructions(today: ISODate, placeNames: string[]): string {
  const names = [...new Set(placeNames)].sort((a, b) => a.localeCompare(b, 'he')).join(', ')
  return `אני אצרף צילומי מסך (אינסטגרם, תפריטים, מודעות) של מקומות בילוי בבאר שבע.
מצא בהם דילים: Happy hour, ימים קבועים (למשל "שלישי יין ללא תחתית"), אירועים בתאריך מסוים, והנחות לכרטיס חבר.
החזר רק בלוק JSON אחד, בלי טקסט נוסף, במבנה הזה בדיוק:

\`\`\`json
{"deals": [{
  "place": "שם המקום כפי שהוא מוכר",
  "address": "כתובת אם מופיעה, אחרת null",
  "title": "תיאור קצר של הדיל, עד 60 תווים, למשל: 1+1 על קוקטיילים",
  "kind": "happy_hour | special_day | event | member_card",
  "days": [0, 1, 2, 3, 4],
  "from": "19:00",
  "to": "21:00",
  "date": null,
  "until": null,
  "note": "תנאים, מחיר או פרט חשוב, עד 200 תווים, אחרת null"
}]}
\`\`\`

כללים:
- היום ${today}. תאריכים בפורמט YYYY-MM-DD; "מחר", "יום חמישי הקרוב" וכדומה הופכים לתאריך מלא.
- kind: happy_hour לשעות מוזלות, special_day ליום קבוע בשבוע, event לאירוע חד־פעמי (חובה date), member_card להנחה לכרטיס חבר.
- days: 0=ראשון, 1=שני, 2=שלישי, 3=רביעי, 4=חמישי, 5=שישי, 6=שבת. [] = כל יום. באירוע: [].
- from/to בפורמט HH:MM (24 שעות). אם אין שעות, או "כל שעות הפתיחה": null בשניהם. אם כתובה רק שעת התחלה ("מ-20:00 עד הסגירה"): from עם השעה, to null.
- until: היום האחרון שהדיל בתוקף, רק אם כתוב; אחרת null.
- אל תמציא: מה שלא מופיע בתמונה הוא null. דיל אחד לכל שורה; כמה דילים באותו מקום הם כמה פריטים.
${names ? `- המקומות שכבר יש באפליקציה (כתוב את השם כמו כאן כשזה אותו מקום): ${names}` : ''}`.trim()
}

/** The JSON in a chat answer: a ```json block, or the first {…} or […]. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = [fenced?.[1], text.slice(text.search(/[[{]/))].filter((c): c is string => !!c?.trim())
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim())
    } catch {
      // A chat may add text after the JSON: cut at the last closing bracket.
      const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
      try {
        if (end > 0) return JSON.parse(candidate.slice(0, end + 1).trim())
      } catch {
        // Try the next candidate.
      }
    }
  }
  return undefined
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** "9:00", "21:30", "2130" → "HH:MM"; anything else null. */
function time(v: unknown): string | null {
  const m = str(v)?.match(/^(\d{1,2})[:.]?(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h <= 24 && min < 60 ? `${String(h % 24).padStart(2, '0')}:${m[2]}` : null
}

function isoDay(v: unknown): ISODate | null {
  const s = str(v)
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? (s as ISODate) : null
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
const DAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

/** 2, "שלישי", "יום שלישי", "ג", "ג׳" → 2. */
function day(d: unknown): number {
  if (typeof d === 'number') return d
  const s = String(d).trim().replace(/^יום\s*/, '').replace(/['׳"]/g, '')
  const byName = DAY_NAMES.indexOf(s)
  return byName >= 0 ? byName : s.length === 1 ? DAY_LETTERS.indexOf(s) : -1
}

function days(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out = v
    .map(day)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return [...new Set(out)].sort((a, b) => a - b)
}

export type ParseResult = { deals: AiDeal[]; error: null } | { deals: []; error: 'no_json' | 'no_deals' }

/** A chat's answer → deals; tolerant of extra text and of small slips. */
export function parseAiDeals(text: string): ParseResult {
  const data = extractJson(text)
  if (data === undefined) return { deals: [], error: 'no_json' }
  const list = Array.isArray(data) ? data : (data as { deals?: unknown })?.deals
  if (!Array.isArray(list)) return { deals: [], error: 'no_deals' }
  const deals = list
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d) => ({
      place: str(d.place) ?? '',
      address: str(d.address),
      title: str(d.title) ?? '',
      kind: KINDS.includes(d.kind as DealKind) ? (d.kind as DealKind) : 'happy_hour',
      days: days(d.days),
      from: time(d.from),
      to: time(d.to),
      date: isoDay(d.date),
      until: isoDay(d.until),
      note: str(d.note),
    }))
    .filter((d) => d.place || d.title)
  return deals.length ? { deals, error: null } : { deals: [], error: 'no_deals' }
}

/** The place a deal names: the best match by name, if any. */
export function matchVenue(venues: Venue[], place: string): Venue | null {
  return searchVenues(venues, place, 1)[0] ?? null
}

/** A deal from the chat as a deal form draft (checked with validateDraft like any other). */
export function aiDealToDraft(deal: AiDeal, venueId: number | null): DealDraft {
  const event = deal.kind === 'event'
  return {
    ...emptyDraft(venueId),
    title: deal.title,
    kind: deal.kind,
    weekdays: event ? [] : deal.days,
    allHours: !(deal.from && deal.to),
    startsAt: deal.from && deal.to ? deal.from : '',
    endsAt: deal.from && deal.to ? deal.to : '',
    date: (event ? deal.date ?? deal.until : deal.until) ?? '',
    // The form takes both times or neither: a start alone goes to the note.
    note: [deal.from && !deal.to ? `מ־${deal.from}` : null, deal.note].filter(Boolean).join(' · ').slice(0, NOTE_MAX),
  }
}
