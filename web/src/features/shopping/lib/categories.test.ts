import { guessCategory, parseItemInput } from './categories'

describe('guessCategory', () => {
  it.each([
    ['חלב 3%', 'dairy'],
    ['עגבניות שרי', 'produce'],
    ['פיתות', 'bakery'],
    ['שוקולד חלב', 'pantry'],
    ['סבון כלים', 'cleaning'],
    ['סבון ידיים', 'hygiene'],
    ['חזה עוף', 'meat'],
    ['מרכך כביסה', 'cleaning'],
    ['מרכך שיער', 'hygiene'],
    ['משהו אחר', 'other'],
  ])('%s → %s', (name, category) => {
    expect(guessCategory(name)).toBe(category)
  })
})

describe('parseItemInput', () => {
  it.each([
    ['2 חלב', 'חלב', 2],
    ['חלב x3', 'חלב', 3],
    ['3x ביצים', 'ביצים', 3],
    ['במבה 4', 'במבה', 4],
    ['חלב 3%', 'חלב 3%', 1],
    ['קולה 1.5', 'קולה 1.5', 1],
    ['פסטה 500', 'פסטה 500', 1],
    ['  לחם  ', 'לחם', 1],
  ])('%s', (input, name, quantity) => {
    expect(parseItemInput(input)).toEqual({ name, quantity })
  })
})
