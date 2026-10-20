import type { PackUnit } from '@/lib/db-types'

/**
 * Same rules as SQL public.norm_name: lowercase, no quotes, punctuation to
 * spaces, digits split from letters. 'קמח 1 ק"ג.' → 'קמח 1 קג'.
 */
export function normName(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`׳״]/g, '')
    .replace(/\s*[*×]\s*/g, ' * ')
    .replace(/(?<![0-9])\.|\.(?![0-9])/g, ' ')
    .replace(/[^0-9a-zא-ת%.*]+/g, ' ')
    .replace(/([0-9%])([a-zא-ת])|([a-zא-ת])([0-9])/g, '$1$3 $2$4')
    .replace(/%(?=\S)/g, '% ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Whole-word containment on normalized text, like SQL public.has_words. */
export function hasWords(normalizedName: string, phrase: string): boolean {
  return phrase !== '' && ` ${normalizedName} `.includes(` ${phrase} `)
}

export interface Pack {
  unit: PackUnit
  qty: number
}

/** "12 יח'", "1.5 ליטר", "750 גרם", 'לק"ג'. */
export function formatPack(pack: Pack | null, weighted = false): string {
  if (weighted) return 'לק"ג'
  if (!pack) return ''
  const n = (v: number) => String(Math.round(v * 100) / 100)
  switch (pack.unit) {
    case 'g':
      return pack.qty >= 1000 ? `${n(pack.qty / 1000)} ק"ג` : `${n(pack.qty)} גרם`
    case 'ml':
      return pack.qty >= 1000 ? `${n(pack.qty / 1000)} ליטר` : `${n(pack.qty)} מ"ל`
    case 'u':
      return `${n(pack.qty)} יח'`
    case 'm':
      return `${n(pack.qty)} מטר`
  }
}

/** Same unit and within `tolerance` of each other (0.15 = ±15%). */
export function packsMatch(a: Pack | null, b: Pack | null, tolerance = 0.15): boolean {
  if (!a || !b) return a === b
  if (a.unit !== b.unit) return false
  return Math.abs(a.qty - b.qty) <= tolerance * b.qty
}
