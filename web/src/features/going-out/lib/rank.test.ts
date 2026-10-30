import type { Venue, VenueDeal } from '@/lib/db-types'
import { BEER_SHEVA } from './geo'
import { buildSections, sheetDeals } from './rank'

// 2026-11-03 is a Tuesday; Israel is UTC+2 then.
const at = (local: string) => new Date(`${local}:00+02:00`)
const TUESDAY_8PM = at('2026-11-03T20:00')
const HOME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let nextId = 0
const venue = (name: string, extra: Partial<Venue> = {}): Venue => ({
  id: ++nextId,
  osm_ref: null,
  name,
  kind: 'bar',
  lat: BEER_SHEVA.center.lat,
  lng: BEER_SHEVA.center.lng,
  address: null,
  opening_hours: null,
  website: null,
  phone: null,
  instagram: null,
  cuisine: null,
  source: 'osm',
  household_id: null,
  created_by: null,
  status: 'approved',
  hidden: false,
  review_note: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...extra,
})

const deal = (v: Venue, title: string, extra: Partial<VenueDeal> = {}): VenueDeal => ({
  id: `${v.id}-${title}`,
  venue_id: v.id,
  household_id: null,
  created_by: null,
  title,
  kind: 'happy_hour',
  weekdays: [],
  starts_at: '19:00:00',
  ends_at: '23:00:00',
  valid_from: null,
  valid_until: null,
  note: null,
  status: 'approved',
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
  last_confirmed_at: '2026-11-01T00:00:00Z',
  created_at: '2026-11-01T00:00:00Z',
  ...extra,
})

/** About `meters` north of the center. */
const north = (meters: number) => ({ lat: BEER_SHEVA.center.lat + meters / 111_195, lng: BEER_SHEVA.center.lng })

describe('buildSections', () => {
  const near = venue('בר קרוב', north(100))
  const far = venue('פאב רחוק', { ...north(2000), kind: 'pub' })
  const closed = venue('בר סגור', { ...north(50), opening_hours: 'Mo-Fr 09:00-17:00' })
  const lost = venue('מקום בלי מיקום', { lat: null, lng: null })
  const cafe = venue('בית קפה', { ...north(300), kind: 'cafe', opening_hours: '24/7' })
  const soon = venue('מסעדה בקרוב', { ...north(400), kind: 'restaurant' })
  const venues = [far, near, closed, lost, cafe, soon]
  const deals = [
    deal(far, 'בירה'),
    deal(near, 'יין'),
    deal(closed, 'לא יופיע'),
    deal(lost, 'גם כאן'),
    deal(soon, 'קינוח', { starts_at: '22:00', ends_at: '23:30' }),
    deal(soon, 'קפה', { starts_at: '23:30', ends_at: '01:00' }),
  ]

  it('puts places with a deal on now in "now", nearest first, without closed ones', () => {
    const { now } = buildSections(venues, deals, BEER_SHEVA.center, TUESDAY_8PM)
    expect(now.map((i) => i.venue.name)).toEqual(['בר קרוב', 'פאב רחוק', 'מקום בלי מיקום'])
    expect(now[0].distanceKm).toBeCloseTo(0.1, 2)
    expect(now[2].distanceKm).toBeNull()
  })

  it('keeps unknown hours in "now"', () => {
    const { now } = buildSections(venues, deals, BEER_SHEVA.center, TUESDAY_8PM)
    expect(now.every((i) => i.open.state === 'unknown')).toBe(true)
  })

  it('orders "later" by start time, then distance', () => {
    const later1 = venue('מאוחר רחוק', north(3000))
    const later2 = venue('מאוחר קרוב', north(10))
    const extra = [
      deal(later1, 'א', { starts_at: '21:00', ends_at: '22:00' }),
      deal(later2, 'ב', { starts_at: '21:00', ends_at: '22:00' }),
    ]
    const { later } = buildSections([...venues, later1, later2], [...deals, ...extra], BEER_SHEVA.center, TUESDAY_8PM)
    expect(later.map((i) => [i.venue.name, i.startsIn])).toEqual([
      ['מאוחר קרוב', 60],
      ['מאוחר רחוק', 60],
      ['מסעדה בקרוב', 120],
    ])
  })

  it('leaves a later deal out when the place is known to be closed when it starts', () => {
    const closedTuesday = venue('סגור בשלישי', { opening_hours: 'We-Su 18:00-02:00' })
    const unknown = venue('שעות לא ידועות')
    const at9 = { starts_at: '21:00', ends_at: '22:00' }
    const { later } = buildSections(
      [closedTuesday, unknown],
      [deal(closedTuesday, 'א', at9), deal(unknown, 'ב', at9)],
      BEER_SHEVA.center,
      TUESDAY_8PM,
    )
    expect(later.map((i) => i.venue.name)).toEqual(['שעות לא ידועות'])
  })

  it('counts an all-hours deal as later when the place opens soon', () => {
    const opensAt9 = venue('נפתח בתשע', { opening_hours: 'Tu 21:00-23:00' })
    const { now, later } = buildSections(
      [opensAt9],
      [deal(opensAt9, 'כל הערב', { starts_at: null, ends_at: null })],
      BEER_SHEVA.center,
      TUESDAY_8PM,
    )
    expect(now).toEqual([])
    expect(later.map((i) => [i.venue.name, i.startsIn])).toEqual([['נפתח בתשע', 60]])
  })

  it('lists every place, a place without a location at the end, open ones first', () => {
    const { all } = buildSections(venues, deals, BEER_SHEVA.center, TUESDAY_8PM)
    expect(all.map((i) => i.venue.name)).toEqual([
      'בית קפה', // open (24/7)
      'בר קרוב',
      'מסעדה בקרוב',
      'פאב רחוק',
      'בר סגור', // closed, though nearest
      'מקום בלי מיקום',
    ])
  })

  it('filters by kind (bars include pubs and clubs) and by "only with a deal"', () => {
    const club = venue('מועדון', { kind: 'nightclub' })
    const other = venue('משהו אחר', { kind: 'other' })
    const list = [...venues, club, other]
    const names = (f: Parameters<typeof buildSections>[4]) =>
      buildSections(list, deals, BEER_SHEVA.center, TUESDAY_8PM, f).all.map((i) => i.venue.name).sort()
    expect(names({ kind: 'bars', dealsOnly: false })).toEqual(
      ['בר סגור', 'בר קרוב', 'מועדון', 'מקום בלי מיקום', 'פאב רחוק'].sort(),
    )
    expect(names({ kind: 'cafes', dealsOnly: false })).toEqual(['בית קפה'])
    expect(names({ kind: 'all', dealsOnly: false })).toContain('משהו אחר')
    expect(names({ kind: 'all', dealsOnly: true })).not.toContain('בית קפה')
    expect(names({ kind: 'all', dealsOnly: true })).not.toContain('מועדון')
    expect(buildSections(list, deals, BEER_SHEVA.center, TUESDAY_8PM, { kind: 'restaurants', dealsOnly: false }).now).toEqual([])
  })

  it("shows a pending deal to its own household only (RLS filters the other one's input)", () => {
    const quiet = venue('בר שקט', north(200))
    const pending = deal(quiet, 'הצעה שלנו', { status: 'pending', household_id: HOME })
    const mine = buildSections([quiet], [pending], BEER_SHEVA.center, TUESDAY_8PM)
    expect(mine.now[0].deals.map((d) => [d.deal.title, d.deal.status])).toEqual([['הצעה שלנו', 'pending']])
    const theirs = buildSections([quiet], [], BEER_SHEVA.center, TUESDAY_8PM)
    expect(theirs.now).toEqual([])
    expect(theirs.all[0].deals).toEqual([])
  })

  it('never puts a rejected suggestion in "now", and shows it last on the card', () => {
    const v = venue('בר', north(10))
    const rejected = deal(v, 'נדחה', { status: 'rejected', household_id: HOME })
    expect(buildSections([v], [rejected], BEER_SHEVA.center, TUESDAY_8PM).now).toEqual([])
    const card = buildSections([v], [rejected, deal(v, 'מחר', { weekdays: [3] })], BEER_SHEVA.center, TUESDAY_8PM)
    expect(card.all[0].deals.map((d) => d.deal.title)).toEqual(['מחר', 'נדחה'])
  })

  it('leaves out hidden places and expired deals', () => {
    const gone = venue('נסגר', { hidden: true })
    const v = venue('בר')
    const old = deal(v, 'ישן', { valid_until: '2026-10-01' })
    const { all } = buildSections([gone, v], [old], BEER_SHEVA.center, TUESDAY_8PM)
    expect(all.map((i) => i.venue.name)).toEqual(['בר'])
    expect(all[0].deals).toEqual([])
  })
})

describe('sheetDeals', () => {
  it('orders active, later, other days, then the household’s own suggestions', () => {
    const v = venue('בר')
    const list = sheetDeals(
      [
        deal(v, 'שלנו', { status: 'pending', household_id: HOME }),
        deal(v, 'מחר', { weekdays: [3] }),
        deal(v, 'בעוד שעה', { starts_at: '21:00', ends_at: '22:00' }),
        deal(v, 'עכשיו'),
        deal(v, 'פג', { valid_until: '2026-10-01' }),
        deal(v, 'נדחה ופג', { status: 'rejected', household_id: HOME, valid_until: '2026-10-01' }),
      ],
      TUESDAY_8PM,
    )
    expect(list.map((d) => d.deal.title)).toEqual(['עכשיו', 'בעוד שעה', 'מחר', 'שלנו', 'נדחה ופג'])
  })
})
