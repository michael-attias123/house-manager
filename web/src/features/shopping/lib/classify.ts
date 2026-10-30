import { normName } from '@/features/prices/lib/normalize'
import { BRANDS, FROZEN_BRANDS, MODIFIERS, PHRASES } from './lexicon'

// Guesses the supermarket department of a shopping-list item, on the phone,
// from lexicon.ts plus what this household taught it (item_categories).
//
// Words, not substrings: "שומשום" does not contain the word "שום". A phrase
// scores by its length, the item's first word counts double (Hebrew puts the
// noun first: "שוקולד חלב" is chocolate), and a phrase hides the shorter
// matches inside it ("חלב שקדים" is not "חלב").

export type Confidence = 'learned' | 'high' | 'low' | 'none'

export interface Classification {
  category: string
  confidence: Confidence
  /** The phrase that decided it, for tests and debugging. */
  matched: string | null
}

const FINALS: Record<string, string> = { ם: 'מ', ן: 'נ', ץ: 'צ', ף: 'פ', ך: 'כ' }
const PREFIXES = ['וה', 'וב', 'ול', 'ומ', 'וש', 'שה', 'מה', 'בה', 'לה', 'כש', 'ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ']
const SUFFIXES = ['ימ', 'ות', 'יות', 'י']
// A feminine singular in ה: "עגבניה" → "עגבניות", "חמאה" → "חמאת", "ביצה" → "ביצימ".
const H_SUFFIXES = ['ות', 'ת', 'ימ', 'יות']
// A score lost when a word only matched after dropping a prefix letter, so
// "מטליות" (cloths) stays cloths and not מ + "טליות" (lambs).
const PREFIX_PENALTY = 5

function fold(word: string): string {
  return word.replace(/[םןץףך]/g, (c) => FINALS[c])
}

/** Normalized words of a name, numbers and units dropped. */
export function words(name: string): string[] {
  return normName(name)
    .split(' ')
    .filter((w) => w && !/^[0-9.%*]+$/.test(w))
    .map(fold)
}

/**
 * Identity of an item on the list: like categoryKey() but numbers count, so
 * "קוטג׳" is "קוטג" while "חלב 3%" and "חלב 1%" stay two items.
 */
export function itemKey(name: string): string {
  return normName(name).split(' ').filter(Boolean).map(fold).join(' ')
}

/** The key a learned department is stored under (item_categories.normalized_name). */
export function categoryKey(name: string): string {
  return words(name).join(' ')
}

interface Word {
  text: string
  stem: boolean
  forms: Set<string>
}

function compileWord(raw: string): Word {
  const stem = raw.endsWith('*')
  const text = fold(normName(stem ? raw.slice(0, -1) : raw))
  const forms = new Set([text])
  if (!stem && text.length >= 2) {
    for (const s of SUFFIXES) forms.add(text + s)
    if (text.endsWith('ה') && text.length >= 3) for (const s of H_SUFFIXES) forms.add(text.slice(0, -1) + s)
    // "מפית" → "מפיות", "שקית" → "שקיות".
    if (text.endsWith('ית') && text.length >= 4) forms.add(text.slice(0, -1) + 'ות')
  }
  return { text, stem, forms }
}

/** The token itself and, for words of 3+ letters, the token without a prefix. */
function candidates(token: string, minLength: number): string[] {
  const out = [token]
  for (const p of PREFIXES) {
    if (token.startsWith(p) && token.length - p.length >= minLength) out.push(token.slice(p.length))
  }
  return out
}

/** 2: the token itself matched, 1: only after dropping a prefix letter, 0: no match. */
function wordMatch(word: Word, token: string): 0 | 1 | 2 {
  const minLength = Math.max(3, word.text.length)
  const tried = word.text.length >= 3 ? candidates(token, minLength) : [token]
  for (let i = 0; i < tried.length; i++) {
    if (word.stem ? tried[i].startsWith(word.text) : word.forms.has(tried[i])) return i === 0 ? 2 : 1
  }
  return 0
}

interface Rule {
  phrase: string
  category: string
  words: Word[]
  /** Points per word, before the first-word bonus. */
  weight: number
  /** Added when the phrase starts the name. */
  headBonus: number
}

function rule(phrase: string, category: string, weight: number, headBonus: number): Rule {
  return { phrase, category, words: phrase.trim().split(/\s+/).map(compileWord), weight, headBonus }
}

const RULES: Rule[] = [
  ...Object.entries(PHRASES).flatMap(([category, list]) => list.map((p) => rule(p, category, 10, 10))),
  ...Object.entries(BRANDS).flatMap(([category, list]) => list.map((p) => rule(p, category, 4, 4))),
  ...FROZEN_BRANDS.map((p) => rule(p, 'frozen', 12, 4)),
  ...Object.entries(MODIFIERS).flatMap(([category, list]) => list.map((p) => rule(p, category, 35, 0))),
]

interface Match {
  rule: Rule
  start: number
  length: number
  score: number
}

function findMatches(tokens: string[], rules: Rule[]): Match[] {
  const found: Match[] = []
  for (const r of rules) {
    const n = r.words.length
    for (let start = 0; start + n <= tokens.length; start++) {
      const quality = r.words.map((w, i) => wordMatch(w, tokens[start + i]))
      if (quality.every((q) => q > 0)) {
        const score =
          r.weight * n + (start === 0 ? r.headBonus : 0) - (quality.some((q) => q === 1) ? PREFIX_PENALTY : 0)
        found.push({ rule: r, start, length: n, score })
        break
      }
    }
  }
  // A phrase hides the shorter matches inside it: "חלב שקדים" is not "חלב".
  return found.filter(
    (m) =>
      !found.some(
        (o) => o.length > m.length && o.start <= m.start && o.start + o.length >= m.start + m.length,
      ),
  )
}

/** Learned names act as phrases that outweigh the lexicon. */
function learnedRules(learned: ReadonlyMap<string, string>): Rule[] {
  return [...learned].map(([key, category]) => rule(key, category, 25, 10))
}

/**
 * The department for an item name. `learned` maps categoryKey() to the
 * department the household chose for it.
 */
export function classify(name: string, learned: ReadonlyMap<string, string> = new Map()): Classification {
  const key = categoryKey(name)
  const exact = learned.get(key)
  if (exact) return { category: exact, confidence: 'learned', matched: key }

  const tokens = key ? key.split(' ') : []
  const matches = findMatches(tokens, [...RULES, ...learnedRules(learned)])
  if (matches.length === 0) return { category: 'other', confidence: 'none', matched: null }

  const totals = new Map<string, number>()
  for (const m of matches) totals.set(m.rule.category, (totals.get(m.rule.category) ?? 0) + m.score)
  const ranked = [...totals].sort((a, b) => b[1] - a[1])
  const [category, best] = ranked[0]
  const runnerUp = ranked[1]?.[1] ?? 0
  const decisive = matches
    .filter((m) => m.rule.category === category)
    .sort((a, b) => b.score - a.score)[0]
  return {
    category,
    confidence: best >= 20 && best - runnerUp >= 10 ? 'high' : 'low',
    matched: decisive.rule.phrase,
  }
}
