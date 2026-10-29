import { categoryKey, classify } from './classify'

// Real shopping-list lines, as people type them. Each trap the old substring
// guesser fell into is here: "שומשום" is not garlic, "חמאת בוטנים" is not
// butter, "דגני בוקר" is not fish.
const CORPUS: [name: string, category: string][] = [
  // produce
  ['עגבניות', 'produce'], ['עגבניות שרי', 'produce'], ['עגבנייה', 'produce'], ['מלפפונים', 'produce'],
  ['בצל', 'produce'], ['בצל ירוק', 'produce'], ['שום', 'produce'], ['תפוחים', 'produce'],
  ['תפוחי אדמה', 'produce'], ['בטטות', 'produce'], ['בננות', 'produce'], ['גזר', 'produce'],
  ['חסה', 'produce'], ['פלפל אדום', 'produce'], ['פלפלים', 'produce'], ['תפוזים', 'produce'],
  ['קלמנטינות', 'produce'], ['לימונים', 'produce'], ['אבוקדו', 'produce'], ['קישואים', 'produce'],
  ['חצילים', 'produce'], ['פטרוזיליה', 'produce'], ['כוסברה', 'produce'], ['נענע', 'produce'],
  ['ענבים', 'produce'], ['אבטיח', 'produce'], ['תותים', 'produce'], ['פטריות', 'produce'],
  ['ברוקולי', 'produce'], ['כרובית', 'produce'], ['סלק', 'produce'], ['מנגו', 'produce'],
  ['ג׳ינג׳ר', 'produce'], ["ג'ינג'ר", 'produce'], ['והעגבניות', 'produce'], ['ירקות', 'produce'],
  // dairy
  ['חלב', 'dairy'], ['חלב 3%', 'dairy'], ['חלב 1% קרטון', 'dairy'], ['גבינה צהובה', 'dairy'],
  ['גבינה לבנה 5%', 'dairy'], ['גבינות', 'dairy'], ['יוגורט', 'dairy'], ['יוגורט יווני', 'dairy'],
  ['שמנת מתוקה', 'dairy'], ['שמנת חמוצה', 'dairy'], ['חמאה', 'dairy'], ['ביצים', 'dairy'],
  ['ביצים L', 'dairy'], ['קוטג׳', 'dairy'], ['קוטג 5%', 'dairy'], ['לבנה', 'dairy'], ['מעדן', 'dairy'],
  ['שוקו', 'dairy'], ['חלב שוקו', 'dairy'], ['בולגרית', 'dairy'], ['מוצרלה', 'dairy'], ['פרמזן', 'dairy'],
  ['מילקי', 'dairy'], ['תנובה', 'dairy'],
  // bakery
  ['לחם', 'bakery'], ['לחם מלא', 'bakery'], ['פיתות', 'bakery'], ['לחמניות', 'bakery'], ['חלה', 'bakery'],
  ['חלות', 'bakery'], ['באגט', 'bakery'], ['טורטיות', 'bakery'], ['לאפות', 'bakery'], ['עוגה', 'bakery'],
  ['עוגיות', 'bakery'], ['קרואסונים', 'bakery'], ['בורקס', 'bakery'],
  // meat and fish
  ['חזה עוף', 'meat'], ['עוף שלם', 'meat'], ['שניצלים', 'meat'], ['בשר טחון', 'meat'], ['סטייק', 'meat'],
  ['כבד עוף', 'meat'], ['פרגיות', 'meat'], ['כרעיים', 'meat'], ['כנפיים', 'meat'], ['המבורגרים', 'meat'],
  ['נקניקיות', 'meat'], ['סלמון', 'meat'], ['פילה סלמון', 'meat'], ['דגים', 'meat'], ['אמנון', 'meat'],
  ['אנטריקוט', 'meat'], ['חזה הודו', 'meat'], ['פסטרמה', 'meat'],
  // pantry
  ['אורז', 'pantry'], ['אורז בסמטי', 'pantry'], ['פסטה', 'pantry'], ['ספגטי', 'pantry'], ['קמח', 'pantry'],
  ['סוכר', 'pantry'], ['מלח', 'pantry'], ['שמן זית', 'pantry'], ['שמן קנולה', 'pantry'],
  ['רוטב עגבניות', 'pantry'], ['רסק עגבניות', 'pantry'], ['קטשופ', 'pantry'], ['מיונז', 'pantry'],
  ['חומוס', 'pantry'], ['טחינה', 'pantry'], ['טונה', 'pantry'], ['תירס', 'pantry'], ['קפה', 'pantry'],
  ['קפה נמס', 'pantry'], ['תה', 'pantry'], ['דגני בוקר', 'pantry'], ['קורנפלקס', 'pantry'],
  ['שיבולת שועל', 'pantry'], ['ריבה', 'pantry'], ['דבש', 'pantry'], ['שוקולד', 'pantry'],
  ['שוקולד חלב', 'pantry'], ['ממרח שוקולד', 'pantry'], ['חמאת בוטנים', 'pantry'], ['פפריקה', 'pantry'],
  ['פלפל שחור', 'pantry'], ['אבקת אפייה', 'pantry'], ['שקדים', 'pantry'], ['אגוזי מלך', 'pantry'],
  ['שומשום', 'pantry'], ['עדשים', 'pantry'], ['במבה', 'pantry'], ['ביסלי', 'pantry'], ["צ'יפס", 'pantry'],
  ['פריכיות', 'pantry'], ['זיתים', 'pantry'], ['מלפפון חמוץ', 'pantry'], ['מלפפונים חמוצים', 'pantry'],
  ['חלב קוקוס', 'pantry'], ['פירורי לחם', 'pantry'], ['פסטו', 'pantry'], ['פתיתים', 'pantry'],
  ['פירות יבשים', 'pantry'], ['אסם פתיתים', 'pantry'],
  // frozen
  ['גלידה', 'frozen'], ['שלגונים', 'frozen'], ['בצק עלים', 'frozen'], ['מלאווח', 'frozen'],
  ['ג׳חנון', 'frozen'], ['פיצה קפואה', 'frozen'], ['שעועית ירוקה קפואה', 'frozen'], ['ירקות קפואים', 'frozen'],
  ['אפונה קפואה', 'frozen'], ['נגטס', 'frozen'], ['סנפרוסט שעועית', 'frozen'], ['תירס קפוא', 'frozen'],
  // drinks
  ['מים', 'drinks'], ['מים מינרליים', 'drinks'], ['סודה', 'drinks'], ['קולה', 'drinks'],
  ['קוקה קולה זירו', 'drinks'], ['מיץ תפוזים', 'drinks'], ['מיץ ענבים', 'drinks'], ['בירה', 'drinks'],
  ['יין אדום', 'drinks'], ['תרכיז', 'drinks'], ['חלב שקדים', 'drinks'], ['חלב סויה', 'drinks'],
  ['משקה שיבולת שועל', 'drinks'], ['תה קר', 'drinks'], ['נביעות', 'drinks'],
  // cleaning
  ['סבון כלים', 'cleaning'], ['נוזל כלים', 'cleaning'], ['אקונומיקה', 'cleaning'], ['מרכך כביסה', 'cleaning'],
  ['אבקת כביסה', 'cleaning'], ['ספוגים', 'cleaning'], ['שקיות זבל', 'cleaning'], ['נייר טואלט', 'cleaning'],
  ['מגבות נייר', 'cleaning'], ['מטליות', 'cleaning'], ['טבליות למדיח', 'cleaning'], ['נייר אפייה', 'cleaning'],
  ['נייר כסף', 'cleaning'], ['מפיות', 'cleaning'], ['סנו', 'cleaning'], ['פיניש', 'cleaning'],
  ['כוסות חד פעמיות', 'cleaning'],
  // hygiene
  ['שמפו', 'hygiene'], ['מרכך שיער', 'hygiene'], ['סבון', 'hygiene'], ['סבון ידיים', 'hygiene'],
  ['משחת שיניים', 'hygiene'], ['מברשת שיניים', 'hygiene'], ['דאודורנט', 'hygiene'], ['תחבושות', 'hygiene'],
  ['מגבונים', 'hygiene'], ['חיתולים', 'hygiene'], ['צמר גפן', 'hygiene'], ['אקמול', 'hygiene'],
  ['פלסטרים', 'hygiene'], ['קרם הגנה', 'hygiene'], ['טישו', 'hygiene'], ['האגיס', 'hygiene'],
  // nothing to go on
  ['משהו אחר', 'other'], ['מתנה לסבתא', 'other'],
]

describe('classify', () => {
  it.each(CORPUS)('%s → %s', (name, category) => {
    expect(classify(name).category).toBe(category)
  })

  it('matches whole words, not substrings', () => {
    expect(classify('שומשום').category).not.toBe('produce')
    expect(classify('חמאת בוטנים').category).not.toBe('dairy')
    expect(classify('דגני בוקר').category).not.toBe('meat')
    expect(classify('מתה').confidence).toBe('none')
  })

  it('says how sure it is', () => {
    expect(classify('חלב').confidence).toBe('high')
    expect(classify('משהו אחר')).toEqual({ category: 'other', confidence: 'none', matched: null })
  })

  it('lets a product word beat a brand', () => {
    expect(classify('תנובה שוקו').category).toBe('dairy')
    expect(classify('אסם קטשופ').category).toBe('pantry')
    expect(classify('עלית קפה').category).toBe('pantry')
  })

  it('learns from the household', () => {
    const learned = new Map([[categoryKey('פסטו'), 'other'], [categoryKey('אבקת חלבון'), 'hygiene']])
    expect(classify('פסטו', learned)).toEqual({ category: 'other', confidence: 'learned', matched: 'פסטו' })
    expect(classify(' פסטו. ', learned).confidence).toBe('learned')
    // A learned name inside a longer one outweighs the lexicon.
    expect(classify('פסטו גנובזה', learned).category).toBe('other')
    expect(classify('אבקת חלבון וניל', learned).category).toBe('hygiene')
    // Other names are unaffected.
    expect(classify('חלב', learned).category).toBe('dairy')
  })
})

describe('categoryKey', () => {
  it('ignores punctuation, numbers and final letters', () => {
    expect(categoryKey(' פסטו. ')).toBe('פסטו')
    expect(categoryKey('חלב 3%')).toBe(categoryKey('חלב'))
    expect(categoryKey('עגבניות שרי')).toBe('עגבניות שרי'.replace('ת', 'ת'))
    expect(categoryKey('ביצים')).toBe('ביצימ')
    expect(categoryKey('123')).toBe('')
  })
})
