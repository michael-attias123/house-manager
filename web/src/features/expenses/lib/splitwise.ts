// Parses a Splitwise group export ("Export as spreadsheet") and turns it
// into expenses and transfers for this app.
//
// The export is a CSV: Date, Description, Category, Cost, Currency, then one
// column per person holding that person's net effect for the row (what they
// paid minus their share). Payments show up either as Category "Payment" or,
// when people logged a repayment as an expense, as a row one person owes in
// full; the last row is "Total balance".
import { fromAgorot, toAgorot } from '@/lib/money'
import type { SplitType } from '@/lib/db-types'

/** RFC 4180 CSV: quoted fields, "" escapes, CRLF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export interface SplitwiseRow {
  /** Line in the file, for messages. */
  line: number
  date: string
  description: string
  category: string
  cost: number
  currency: string
  /** Net effect per person column (paid minus share), in shekels. */
  values: number[]
}

export interface SplitwiseFile {
  people: string[]
  rows: SplitwiseRow[]
  /** The "Total balance" row, per person, when present. */
  totals: number[] | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function parseSplitwise(text: string): SplitwiseFile {
  const table = parseCsv(text)
  const header = table[0]?.map((h) => h.trim()) ?? []
  if (header.length < 6 || !/date/i.test(header[0]) || !/cost/i.test(header[3])) {
    throw new Error(
      'זה לא נראה כמו קובץ ייצוא של Splitwise (חסרות העמודות Date, Description, Category, Cost, Currency ושמות).',
    )
  }
  const people = header.slice(5)
  const rows: SplitwiseRow[] = []
  let totals: number[] | null = null

  table.slice(1).forEach((cells, index) => {
    if (cells.every((c) => !c.trim())) return
    const [date, description = '', category = '', cost = '', currency = '', ...rest] = cells.map(
      (c) => c.trim(),
    )
    const values = people.map((_, i) => Number(rest[i] || 0))
    if (/^total balance$/i.test(description)) {
      totals = values
      return
    }
    if (
      !DATE.test(date) ||
      !cost ||
      values.some((v) => Number.isNaN(v)) ||
      Number.isNaN(Number(cost))
    )
      return
    rows.push({
      line: index + 2,
      date,
      description,
      category,
      cost: Number(cost),
      currency,
      values,
    })
  })
  return { people, rows, totals }
}

// ---------------------------------------------------------------------------
// Turning rows into expenses and transfers

export type RowKind = 'expense' | 'transfer'

/** Splitwise's own categories, when people used them. */
const SPLITWISE_CATEGORIES: Record<string, string> = {
  groceries: 'groceries',
  'dining out': 'eating_out',
  rent: 'rent',
  mortgage: 'rent',
  electricity: 'bills',
  'heat/gas': 'bills',
  water: 'bills',
  'tv/phone/internet': 'bills',
  trash: 'bills',
  'utilities - other': 'bills',
  cleaning: 'home',
  'household supplies': 'home',
  furniture: 'home',
  maintenance: 'home',
  electronics: 'home',
  'home - other': 'home',
  services: 'home',
  pets: 'pets',
  'gas/fuel': 'transport',
  parking: 'transport',
  car: 'transport',
  'bus/train': 'transport',
  taxi: 'transport',
  bicycle: 'transport',
  'transportation - other': 'transport',
  plane: 'travel',
  hotel: 'travel',
  'medical expenses': 'health',
  gifts: 'gifts',
  movies: 'fun',
  music: 'fun',
  games: 'fun',
  sports: 'fun',
  liquor: 'fun',
  'entertainment - other': 'fun',
}

/** Description keywords (Hebrew and English); the longest match wins. */
const KEYWORDS: Record<string, string[]> = {
  rent: ['שכר דירה', 'שכירות', 'משכנתא', 'rent'],
  bills: [
    'גז',
    'חשמל',
    'מים',
    'ארנונה',
    'אינטרנט',
    'ועד בית',
    'סלולר',
    'טלפון',
    'נטפליקס',
    'electricity',
    'water',
    'internet',
  ],
  transport: [
    'דלק',
    'חניה',
    'חנייה',
    'רכב',
    'טסט',
    'מוסך',
    'מונית',
    'רכבת',
    'אוטובוס',
    'fuel',
    'parking',
    'taxi',
  ],
  groceries: [
    'סופר',
    'קניות',
    'שופרסל',
    'רמי לוי',
    'אושר עד',
    'קרפור',
    'דבאח',
    'מכולת',
    'ירקות',
    'groceries',
    'supermarket',
  ],
  eating_out: [
    'מסעדה',
    'פיצה',
    'סושי',
    'בורגר',
    'קפה',
    'וולט',
    'תן ביס',
    'ארוחה',
    'restaurant',
    'pizza',
    'sushi',
    'wolt',
  ],
  travel: [
    'טיול',
    'חו"ל',
    'חו״ל',
    'ח"ול',
    'טיסה',
    'מלון',
    'חופשה',
    'נופש',
    'צימר',
    'flight',
    'hotel',
    'trip',
  ],
  gifts: ['מתנה', 'יום הולדת', 'gift'],
  health: ['רופא', 'תרופות', 'בית מרקחת', 'סופר פארם', 'קופת חולים', 'pharmacy', 'doctor'],
  home: ['רהיטים', 'איקאה', 'ikea', 'כלי בית', 'ניקיון'],
  fun: ['סרט', 'קולנוע', 'הופעה', 'movie', 'concert'],
  pets: ['וטרינר', 'אוכל לכלב', 'אוכל לחתול', 'vet'],
}

export function guessExpenseCategory(description: string, splitwiseCategory: string): string {
  const mapped = SPLITWISE_CATEGORIES[splitwiseCategory.trim().toLowerCase()]
  if (mapped) return mapped
  const text = description.toLowerCase()
  let best = { id: 'other', length: 0 }
  for (const [id, words] of Object.entries(KEYWORDS)) {
    for (const word of words) {
      if (word.length > best.length && text.includes(word)) best = { id, length: word.length }
    }
  }
  return best.id
}

const TRANSFER_WORDS =
  /החזר|להחזיר|החזרתי|העברה|העברתי|ביט|פייבוקס|סגירת חשבון|\bbit\b|paybox|payment|paid|repay|settle/i

/**
 * A row is probably a repayment, not spending, when Splitwise marked it as a
 * payment, or when one person owes all of it and the description says so.
 */
export function guessKind(row: SplitwiseRow): RowKind {
  if (/^payment$/i.test(row.category.trim())) return 'transfer'
  const cost = toAgorot(row.cost)
  const owedInFull = row.values.some((v) => toAgorot(-v) === cost)
  return owedInFull && TRANSFER_WORDS.test(row.description) ? 'transfer' : 'expense'
}

export interface ImportExpense {
  externalId: string
  date: string
  description: string
  amount: number
  paidBy: string
  shares: Record<string, number>
  splitType: SplitType
  category: string
}

export interface ImportTransfer {
  externalId: string
  date: string
  note: string
  amount: number
  from: string
  to: string
}

export type Conversion =
  | { ok: true; expense: ImportExpense }
  | { ok: true; transfer: ImportTransfer }
  | { ok: false; reason: string }

/** A stable id for a row, so importing the same file twice adds nothing. */
export function rowKey(row: SplitwiseRow, occurrence: number): string {
  return [
    'splitwise',
    row.date,
    row.description,
    row.cost.toFixed(2),
    row.currency,
    ...row.values.map((v) => v.toFixed(2)),
    occurrence,
  ].join('|')
}

/**
 * Converts one row. `people` maps each person column to a member id, or null
 * for someone outside the household.
 */
export function convertRow(
  row: SplitwiseRow,
  key: string,
  people: (string | null)[],
  kind: RowKind,
  category: string,
): Conversion {
  if (row.currency && row.currency.toUpperCase() !== 'ILS')
    return { ok: false, reason: `מטבע ${row.currency}` }
  const outsider = row.values.findIndex((v, i) => people[i] === null && toAgorot(v) !== 0)
  if (outsider !== -1) return { ok: false, reason: 'כולל מישהו שלא בבית' }

  const nets = new Map<string, number>()
  row.values.forEach((v, i) => {
    const member = people[i]
    if (member) nets.set(member, (nets.get(member) ?? 0) + toAgorot(v))
  })
  const entries = [...nets.entries()]
  if (entries.reduce((s, [, v]) => s + v, 0) !== 0) return { ok: false, reason: 'השורה לא מאוזנת' }
  const payers = entries.filter(([, v]) => v > 0)
  if (payers.length === 0) return { ok: false, reason: 'אין השפעה על המאזן (לא ידוע מי שילם)' }
  if (payers.length > 1) return { ok: false, reason: 'כמה אנשים שילמו' }
  const [payer, payerNet] = payers[0]
  const cost = toAgorot(row.cost)

  if (kind === 'transfer') {
    const receivers = entries.filter(([, v]) => v < 0)
    if (receivers.length !== 1) return { ok: false, reason: 'העברה צריכה להיות בין שני אנשים' }
    return {
      ok: true,
      transfer: {
        externalId: key,
        date: row.date,
        note: row.description,
        amount: fromAgorot(payerNet),
        from: payer,
        to: receivers[0][0],
      },
    }
  }

  if (payerNet > cost) return { ok: false, reason: 'הסכומים גדולים מעלות ההוצאה' }
  const shares: Record<string, number> = {}
  for (const [member, net] of entries) {
    const share = member === payer ? cost - net : -net
    if (share > 0) shares[member] = fromAgorot(share)
  }
  const values = Object.values(shares)
  const splitType: SplitType =
    values.length === 1 ? 'full' : values.every((v) => v === values[0]) ? 'equal' : 'exact'
  return {
    ok: true,
    expense: {
      externalId: key,
      date: row.date,
      description: row.description || 'הוצאה מ-Splitwise',
      amount: fromAgorot(cost),
      paidBy: payer,
      shares,
      splitType,
      category,
    },
  }
}

/** Keys for every row, numbering identical rows so each stays distinct. */
export function rowKeys(rows: SplitwiseRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const base = rowKey(row, 0)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return rowKey(row, n)
  })
}

/** Which person column is which member: the signed-in user's name first, then the rest in order. */
export function guessPeople(
  people: string[],
  members: { user_id: string; display_name: string }[],
  me: { id: string; names: string[] },
): (string | null)[] {
  const norm = (s: string) => s.trim().toLowerCase()
  const myNames = me.names.filter(Boolean).map(norm)
  const result: (string | null)[] = people.map(() => null)
  const taken = new Set<string>()

  const assign = (i: number, id: string) => {
    result[i] = id
    taken.add(id)
  }
  // 1. Exact or first-name match against member names and my Google name.
  people.forEach((name, i) => {
    const n = norm(name)
    const first = n.split(/\s+/)[0]
    const member = members.find(
      (m) =>
        !taken.has(m.user_id) && (norm(m.display_name) === n || norm(m.display_name) === first),
    )
    if (member) assign(i, member.user_id)
    else if (!taken.has(me.id) && myNames.some((x) => x === n || x.split(/\s+/)[0] === first))
      assign(i, me.id)
  })
  // 2. With as many columns as members, the rest pair up in order.
  if (people.length === members.length) {
    people.forEach((_, i) => {
      if (result[i]) return
      const next = members.find((m) => !taken.has(m.user_id))
      if (next) assign(i, next.user_id)
    })
  }
  return result
}

/** Per member, the sum of the rows' effects; should equal Splitwise's total. */
export function balanceFromRows(
  rows: SplitwiseRow[],
  people: (string | null)[],
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    row.values.forEach((v, i) => {
      const member = people[i]
      if (member) totals[member] = (totals[member] ?? 0) + toAgorot(v)
    })
  }
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fromAgorot(v)]))
}
