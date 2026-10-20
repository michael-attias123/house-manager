import type { Pack } from './normalize'
import { normName } from './normalize'

/**
 * What a plain list item means, for the items people write most. Tuned on
 * the real catalogue (scripts/price-probe.sql): stores name products with
 * their type first ("ביצים אריזון 12 גדול"), produce in the singular and
 * priced per kg, and the standard pack in the name.
 *
 * - names:   list-item names this applies to (any spelling people use)
 * - terms:   what product names start with
 * - exclude: words that make it a different product (on top of GENERIC_EXCLUDE)
 * - require: at least one of these words (the standard variant)
 * - weighted: sold by weight (true) or packaged (false)
 * - pack:    the size compared in every store; without it, the most common one
 */
export interface Staple {
  names: string[]
  terms: string[]
  exclude?: string[]
  require?: string[]
  weighted?: boolean
  pack?: Pack
}

/** Words that turn a product into something else ("סלט ביצים", "מיץ תפוזים"). */
export const GENERIC_EXCLUDE = [
  'סלט',
  'ממרח',
  'קוצץ',
  'רוטב',
  'בטעם',
  'חטיף',
  'עוגיות',
  'עוגת',
  'מיץ',
  'נקטר',
  'משקה',
  'תרכיז',
  'סירופ',
  'תבלין',
  'תערובת',
  'מועך',
  'דיספנסר',
]

const PRODUCE_EXTRAS = ['אורגני', 'אורגנית', 'אורגניות', 'אורגניים', 'מיובש', 'מיובשת', 'מיובשים']

const produce = (names: string[], terms: string[], exclude: string[] = []): Staple => ({
  names,
  terms,
  exclude: [...exclude, ...PRODUCE_EXTRAS],
  weighted: true,
})

export const STAPLES: Staple[] = [
  {
    names: ['ביצים', 'ביצה', 'ביצי', 'ביצים l', 'ביצים גדולות'],
    terms: ['ביצים'],
    require: ['l', 'גדול', 'גדולות'],
    exclude: ['אומגה', 'חופש', 'שליו', 'dha', 'אורגניות', 'אורגני'],
    pack: { unit: 'u', qty: 12 },
  },
  {
    // Stores write the size as a letter or a word: M / בינוני.
    names: ['ביצים m', 'ביצים בינוניות', 'ביצים בינוני'],
    terms: ['ביצים'],
    require: ['m', 'בינוני', 'בינוניות', 'בנוני'],
    exclude: ['אומגה', 'חופש', 'שליו', 'dha', 'אורגניות', 'אורגני'],
    pack: { unit: 'u', qty: 12 },
  },
  {
    names: ['ביצים xl', 'ביצים ענק'],
    terms: ['ביצים'],
    require: ['xl', 'ענק'],
    exclude: ['אומגה', 'חופש', 'שליו', 'dha', 'אורגניות', 'אורגני'],
    pack: { unit: 'u', qty: 12 },
  },
  {
    names: ['חלב', 'חלב 3%', 'חלב טרי'],
    terms: ['חלב'],
    require: ['3%'],
    exclude: ['עיזים', 'סויה', 'שקדים', 'שיבולת', 'לקטוז', 'מרוכז', 'אבקה', 'אבקת', 'שוקו', 'מפורק', 'אורגני'],
    pack: { unit: 'ml', qty: 1000 },
  },
  {
    // A standard 750 g loaf; the cheapest one is usually לחם אחיד.
    names: ['לחם', 'לחם פרוס', 'לחם לבן'],
    terms: ['לחם'],
    exclude: ['גלוטן', 'ללג', 'קפוא', 'חמניות'],
    weighted: false,
    pack: { unit: 'g', qty: 750 },
  },
  { names: ['לחם אחיד'], terms: ['לחם אחיד'], exclude: ['קפוא'], weighted: false },
  produce(['עגבניות', 'עגבניה', 'עגבנייה'], ['עגבניה', 'עגבניות', 'עגבנייה'], ['שרי']),
  produce(['עגבניות שרי', 'שרי'], ['עגבניות שרי', 'עגבניה שרי', 'עגבניית שרי']),
  produce(['מלפפונים', 'מלפפון'], ['מלפפון', 'מלפפונים'], ['בייבי']),
  produce(['בצל', 'בצל יבש', 'בצלים'], ['בצל יבש', 'בצל'], ['ירוק', 'מטוגן', 'שאלוט', 'קצוץ', 'אדום', 'מקורמל']),
  produce(['בצל אדום'], ['בצל אדום', 'בצל יבש אדום']),
  produce(['בצל ירוק'], ['בצל ירוק']),
  produce(['תפוחי אדמה', 'תפוח אדמה', 'תפוא'], ['תפוח אדמה', 'תפוחי אדמה']),
  produce(['בטטה', 'בטטות'], ['בטטה', 'בטטות']),
  produce(['גזר'], ['גזר'], ['גמדי', 'חתוך', 'מרוקאי', 'קוריאני', 'טבעות']),
  produce(['פלפל', 'פלפלים', 'פלפל אדום'], ['פלפל אדום', 'פלפל'], ['חריף', 'שחור', 'צילי']),
  produce(['פלפל ירוק'], ['פלפל ירוק']),
  produce(['כרוב', 'כרוב לבן'], ['כרוב לבן', 'כרוב'], ['ניצנים', 'סלט']),
  produce(['קישואים', 'קישוא'], ['קישוא', 'קישואים']),
  produce(['חצילים', 'חציל'], ['חציל', 'חצילים']),
  produce(['לימונים', 'לימון'], ['לימון', 'לימונים'], ['מלח']),
  produce(['אבוקדו'], ['אבוקדו']),
  produce(['תפוחים', 'תפוח', 'תפוחי עץ', 'תפוח עץ'], ['תפוח עץ', 'תפוחי עץ', 'תפוח'], ['אדמה']),
  produce(['תפוזים', 'תפוז'], ['תפוז', 'תפוזים']),
  produce(['בננות', 'בננה'], ['בננה', 'בננות'], ['ציפס', 'מסוכרת']),
  produce(['אגסים', 'אגס'], ['אגס', 'אגסים'], ['תפוח']),
  produce(['ענבים'], ['ענבים']),
  produce(['אבטיח'], ['אבטיח'], ['במיכל']),
  produce(['מלון'], ['מלון']),
  produce(['שום'], ['שום'], ['אבקת', 'כתוש', 'קלוף']),
  {
    names: ['קוטג', 'קוטג 5%', 'גבינת קוטג'],
    terms: ['קוטג', 'גבינת קוטג'],
    require: ['5%'],
    exclude: ['זיתים', 'בקטנה'],
    pack: { unit: 'g', qty: 250 },
  },
  {
    names: ['גבינה לבנה', 'גבינה לבנה 5%'],
    terms: ['גבינה לבנה'],
    require: ['5%'],
    exclude: ['עיזים', 'למריחה'],
    pack: { unit: 'g', qty: 250 },
  },
  { names: ['גבינה צהובה'], terms: ['גבינה צהובה'], weighted: false },
  { names: ['גבינה בולגרית', 'בולגרית'], terms: ['גבינה בולגרית', 'בולגרית'], weighted: false },
  { names: ['שמנת'], terms: ['שמנת'], exclude: ['טופו', 'צמחית', 'צמחי'] },
  { names: ['שמנת חמוצה'], terms: ['שמנת חמוצה'] },
  { names: ['שמנת מתוקה'], terms: ['שמנת מתוקה'] },
  { names: ['שמנת לבישול'], terms: ['שמנת לבישול'] },
  { names: ['חמאה'], terms: ['חמאה'], exclude: ['איטלקית', 'מלוחה'], pack: { unit: 'g', qty: 200 } },
  { names: ['אורז'], terms: ['אורז'], exclude: ['מלא', 'פריך', 'פריכיות'], pack: { unit: 'g', qty: 1000 } },
  { names: ['פסטה'], terms: ['פסטה'], exclude: ['גלוטן', 'עם', 'למילוי'], pack: { unit: 'g', qty: 500 } },
  { names: ['ספגטי'], terms: ['ספגטי', 'פסטה ספגטי'], exclude: ['גלוטן'], pack: { unit: 'g', qty: 500 } },
  {
    names: ['סוכר', 'סוכר לבן'],
    terms: ['סוכר לבן', 'סוכר'],
    exclude: ['חום', 'דמררה', 'קנים', 'אבקת', 'גולדן', 'וניל', 'קוקוס'],
    pack: { unit: 'g', qty: 1000 },
  },
  {
    names: ['קמח', 'קמח לבן'],
    terms: ['קמח לבן', 'קמח'],
    exclude: ['גלוטן', 'חומוס', 'שקד', 'שקדים', 'כוסמין', 'מלא', 'תופח', 'פיצה', 'שמרים', 'תירס', 'אורז'],
    pack: { unit: 'g', qty: 1000 },
  },
  {
    names: ['שמן', 'שמן קנולה'],
    terms: ['שמן קנולה', 'שמן חמניות', 'שמן'],
    exclude: ['גוף', 'בייבי', 'תינוקות', 'שיער', 'זית', 'קוקוס', 'אתרי', 'עיסוי', 'ריסוס', 'ויטמין', 'אבוקדו', 'שומשום', 'זרעי', 'קיק'],
    pack: { unit: 'ml', qty: 1000 },
  },
  { names: ['שמן זית'], terms: ['שמן זית'] },
  {
    names: ['מלח'],
    terms: ['מלח'],
    exclude: ['לימון', 'הימלאיה', 'מופחת', 'גס', 'ים'],
    pack: { unit: 'g', qty: 1000 },
  },
  { names: ['טחינה'], terms: ['טחינה'] },
  { names: ['חומוס'], terms: ['חומוס'], exclude: ['קפוא', 'קמח', 'יבש', 'גרגרי'] },
  { names: ['טונה'], terms: ['טונה'], exclude: ['עם', 'סטייק', 'פילה'] },
  { names: ['קורנפלקס'], terms: ['קורנפלקס'], exclude: ['דבש', 'גלוטן'] },
  { names: ['נייר טואלט'], terms: ['נייר טואלט'], exclude: ['לח'] },
  { names: ['מגבות נייר'], terms: ['מגבות נייר'] },
  {
    names: ['סבון כלים', 'נוזל כלים', 'נוזל לכלים'],
    terms: ['נוזל כלים', 'סבון כלים', 'נוזל ניקוי כלים', 'נוזל לניקוי כלים'],
    pack: { unit: 'ml', qty: 750 },
  },
  { names: ['חזה עוף'], terms: ['חזה עוף'], exclude: ['קפוא', 'פרוס', 'מעושן'], weighted: true },
  { names: ['פרגיות', 'פרגית'], terms: ['פרגית', 'פרגיות'], exclude: ['קפוא', 'סטייק'], weighted: true },
  { names: ['שוקיים'], terms: ['שוקיים'], exclude: ['קפוא', 'הודו'], weighted: true },
  { names: ['כרעיים'], terms: ['כרעיים'], exclude: ['קפוא', 'הודו'], weighted: true },
  { names: ['בשר טחון'], terms: ['בשר טחון', 'בשר בקר טחון'], exclude: ['קפוא', 'עוף', 'הודו'], weighted: true },
  { names: ['שניצל', 'שניצל עוף'], terms: ['שניצל עוף'], exclude: ['קפוא'], weighted: true },
  { names: ['קולה', 'קוקה קולה'], terms: ['קוקה קולה', 'קולה'], exclude: ['זירו', 'zero', 'דיאט', 'לימון', 'שישייה'], pack: { unit: 'ml', qty: 1500 } },
  { names: ['במבה'], terms: ['במבה'], exclude: ['במילוי', 'מאנצ', 'תות', 'נוגט', 'מולטי'] },
  { names: ['פיתות', 'פיתה'], terms: ['פיתות', 'פיתה'], exclude: ['גלוטן', 'כוסמין'] },
]

const byName = new Map<string, Staple>()
for (const staple of STAPLES) {
  for (const name of staple.names) byName.set(normName(name), staple)
}

/** The staple an item name (normalized) stands for, if any. */
export function findStaple(normalizedName: string): Staple | undefined {
  return byName.get(normalizedName)
}

/**
 * The staple an item is a variant of ("ביצים M" of ביצים, "חלב 1%" of חלב):
 * the longest staple name the item starts with. Its exclusions and weighing
 * still apply; its terms, required words and pack size don't.
 */
export function findStapleFamily(normalizedName: string): Staple | undefined {
  const words = normalizedName.split(' ')
  for (let n = words.length - 1; n > 0; n--) {
    const staple = byName.get(words.slice(0, n).join(' '))
    if (staple) return staple
  }
  return undefined
}
