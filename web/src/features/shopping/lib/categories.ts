export interface ShoppingCategory {
  id: string
  label: string
  emoji: string
  keywords: string[]
}

/** Supermarket departments, in a typical walking order. */
export const SHOPPING_CATEGORIES: ShoppingCategory[] = [
  {
    id: 'produce',
    label: 'פירות וירקות',
    emoji: '🥦',
    keywords: [
      'עגבני', 'מלפפון', 'בצל', 'שום', 'תפוח', 'תפוא', 'תפוחי אדמה', 'בטטה', 'בננה', 'גזר', 'חסה',
      'פלפל', 'תפוז', 'קלמנטינ', 'לימון', 'אבוקדו', 'קישוא', 'חציל', 'פטרוזיליה', 'כוסברה', 'שמיר',
      'נענע', 'ענבים', 'אבטיח', 'מלון', 'אגס', 'תות', 'פטריות', 'כרוב', 'ברוקולי', 'כרובית', 'סלרי',
      'צנון', 'דלעת', 'סלק', 'רימון', 'מנגו', 'אפרסק', 'שזיף', 'קיווי', 'ירקות', 'פירות', 'תרד',
      'ג׳ינג׳ר', "ג'ינג'ר", 'בזיליקום',
    ],
  },
  {
    id: 'dairy',
    label: 'חלב וביצים',
    emoji: '🥛',
    keywords: [
      'חלב', 'גבינ', 'יוגורט', 'שמנת', 'חמאה', 'ביצים', 'ביצה', 'קוטג', 'לבן', 'אשל', 'מעדן', 'שוקו',
      'פודינג', 'לבנה', 'בולגרית', 'צפתית', 'מוצרלה', 'פרמזן', 'גאודה', 'עמק', 'דנונה', 'מילקי',
    ],
  },
  {
    id: 'bakery',
    label: 'לחם ומאפים',
    emoji: '🥖',
    keywords: ['לחם', 'פיתה', 'פיתות', 'לחמני', 'חלה', 'באגט', 'טורטי', 'עוגה', 'עוגיות', 'קרואסון', 'בורקס', 'לאפה'],
  },
  {
    id: 'meat',
    label: 'בשר, עוף ודגים',
    emoji: '🍗',
    keywords: [
      'עוף', 'חזה', 'שניצל', 'בשר', 'טחון', 'סטייק', 'כבד', 'הודו', 'נקניק', 'פרגית', 'כרעיים',
      'שוקיים', 'כנפיים', 'המבורגר', 'קבב', 'דג', 'סלמון', 'אמנון', 'פילה', 'מוסר', 'אנטריקוט',
    ],
  },
  {
    id: 'pantry',
    label: 'מזווה',
    emoji: '🥫',
    keywords: [
      'אורז', 'פסטה', 'ספגטי', 'קמח', 'סוכר', 'מלח', 'שמן', 'רוטב', 'קטשופ', 'מיונז', 'חומוס',
      'טחינה', 'שימורים', 'טונה', 'תירס', 'קפה', 'תה', 'קורנפלקס', 'דגני', 'ריבה', 'דבש', 'שוקולד',
      'ממרח', 'תבלין', 'פפריקה', 'כמון', 'אבקת', 'שקדים', 'אגוז', 'עדשים', 'שעועית', 'קוסקוס',
      'פתיתים', 'בורגול', 'קינואה', 'חטיף', 'במבה', 'ביסלי', "צ'יפס", 'ציפס', 'קרקר', 'פריכיות',
      'חרדל', 'חומץ', 'שמרים', 'סילאן', 'זיתים', 'מלפפון חמוץ', 'חמוצים', 'גרנולה', 'שיבולת',
    ],
  },
  {
    id: 'frozen',
    label: 'קפואים',
    emoji: '🧊',
    keywords: ['קפוא', 'גלידה', 'שלגון', 'בצק', 'מלאווח', "ג'חנון", 'פיצה קפואה'],
  },
  {
    id: 'drinks',
    label: 'שתייה',
    emoji: '🥤',
    keywords: ['מים', 'סודה', 'קולה', 'מיץ', 'בירה', 'יין', 'משקה', 'תרכיז', 'ספרייט', 'פריגת', 'שוופס', 'נביעות'],
  },
  {
    id: 'cleaning',
    label: 'ניקיון וכביסה',
    emoji: '🧽',
    keywords: [
      'סבון כלים', 'אקונומיקה', 'נוזל', 'מרכך', 'כביסה', 'ספוג', 'שקיות זבל', 'נייר טואלט',
      'מגבות נייר', 'מגבת נייר', 'מטליות', 'כלור', 'אנטי קאלק', 'מסיר', 'טבליות למדיח', 'מדיח',
      'נייר אפייה', 'נייר כסף', 'ניילון נצמד', 'שקיות', 'מפיות', 'סנו',
    ],
  },
  {
    id: 'hygiene',
    label: 'טיפוח ופארם',
    emoji: '🧴',
    keywords: [
      'שמפו', 'מרכך שיער', 'סבון', 'משחת שיניים', 'מברשת שיניים', 'דאודורנט', 'תחבושות', 'טמפונים',
      'גילוח', 'קרם', 'מגבונים', 'חיתולים', 'צמר גפן', 'מקלוני אוזניים', 'אקמול', 'אופטלגין', 'פלסטר',
    ],
  },
  { id: 'other', label: 'שונות', emoji: '🛒', keywords: [] },
]

const byId = new Map(SHOPPING_CATEGORIES.map((c, i) => [c.id, { ...c, order: i }]))

export function getCategory(id: string) {
  return byId.get(id) ?? byId.get('other')!
}

/** Picks the department whose longest keyword appears in the name. */
export function guessCategory(name: string): string {
  const normalized = name.trim().toLowerCase()
  let best = { id: 'other', length: 0 }
  for (const category of SHOPPING_CATEGORIES) {
    for (const keyword of category.keywords) {
      if (keyword.length > best.length && normalized.includes(keyword)) {
        best = { id: category.id, length: keyword.length }
      }
    }
  }
  return best.id
}

/**
 * Splits a quick-add line into name and quantity: "2 חלב", "חלב 2",
 * "חלב x3" and "3x חלב" all work.
 */
export function parseItemInput(input: string): { name: string; quantity: number } {
  const text = input.trim().replace(/\s+/g, ' ')
  const patterns = [/^(\d+(?:\.\d+)?)\s*[x×*]?\s+(.+)$/i, /^(.+?)\s+[x×*]?\s*(\d+(?:\.\d+)?)$/i]
  const leading = text.match(patterns[0])
  if (leading) return { name: leading[2].trim(), quantity: Number(leading[1]) }
  const trailing = text.match(patterns[1])
  // Avoid treating "חלב 3%" or "קוקה קולה 1.5" (litres) as a quantity.
  if (trailing && !/[%.]/.test(trailing[2]) && Number(trailing[2]) <= 30) {
    return { name: trailing[1].trim(), quantity: Number(trailing[2]) }
  }
  return { name: text, quantity: 1 }
}
