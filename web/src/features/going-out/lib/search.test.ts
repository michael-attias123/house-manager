import type { Venue } from '@/lib/db-types'
import { BEER_SHEVA } from './geo'
import { buildSections } from './rank'
import { findSimilar, instagramUrl, mapsUrl, matchRank, searchItems, searchVenues, venueKey, wazeUrl, websiteUrl } from './search'

let nextId = 0
const venue = (name: string, extra: Partial<Venue> = {}): Venue => ({
  id: ++nextId,
  osm_ref: null,
  name,
  kind: 'bar',
  lat: 31.25,
  lng: 34.79,
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
  hidden_by_admin: false,
  review_note: null,
  suggested_household_id: null,
  admin_edited_at: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...extra,
})

describe('searchVenues', () => {
  const venues = [
    venue('פאב השכונה'),
    venue('בר הדוגמה'),
    venue('הבר של השכנים'),
    venue('ביסטרו בר'),
    venue('בר שנדחה', { status: 'rejected' }),
  ]

  it('puts names that start with the query first, then words, then the rest', () => {
    expect(searchVenues(venues, 'בר').map((v) => v.name)).toEqual(['בר הדוגמה', 'ביסטרו בר', 'הבר של השכנים'])
  })

  it('ignores case, quotes and punctuation, and returns nothing for an empty query', () => {
    expect(searchVenues([venue('Bar "Noir"')], 'bar noir').map((v) => v.name)).toEqual(['Bar "Noir"'])
    expect(searchVenues([venue('בר הג׳אז')], 'בר הגאז').map((v) => v.name)).toEqual(['בר הג׳אז'])
    expect(searchVenues(venues, '  ')).toEqual([])
  })
})

describe('findSimilar', () => {
  const existing = venue('בר הדוגמה', { lat: 31.2400, lng: 34.7900 })

  it('finds the same normalized name', () => {
    expect(findSimilar([existing], '  בר   הדוגמה! ', null)).toBe(existing)
  })

  it('finds a place within 50 m, not one further away', () => {
    expect(findSimilar([existing], 'שם אחר', { lat: 31.2403, lng: 34.79 })?.name).toBe('בר הדוגמה') // ~33 m
    expect(findSimilar([existing], 'שם אחר', { lat: 31.2406, lng: 34.79 })).toBeNull() // ~67 m
    expect(findSimilar([existing], 'שם אחר', null)).toBeNull()
  })

  it('skips a rejected suggestion', () => {
    expect(findSimilar([venue('בר', { status: 'rejected' })], 'בר', null)).toBeNull()
  })
})

describe('links', () => {
  it('builds navigation and contact links', () => {
    expect(wazeUrl({ lat: 31.24, lng: 34.79 })).toBe('https://waze.com/ul?ll=31.24,34.79&navigate=yes')
    expect(mapsUrl({ lat: 31.24, lng: 34.79 })).toBe('https://www.google.com/maps/dir/?api=1&destination=31.24,34.79')
    expect(instagramUrl('@demo.bar')).toBe('https://instagram.com/demo.bar')
    expect(instagramUrl('https://instagram.com/x')).toBe('https://instagram.com/x')
    expect(websiteUrl('example.com')).toBe('https://example.com')
  })
})

describe('matchRank', () => {
  const rank = (name: string, query: string) => matchRank(name, venueKey(query))
  it('ranks a start before a word before anywhere', () => {
    expect(rank('בר הדוגמה', 'בר')).toBe(0)
    expect(rank('ביסטרו בר', 'בר')).toBe(1)
    expect(rank('הבר של השכנים', 'בר')).toBe(2)
    expect(rank('פאב השכונה', 'בר')).toBeNull()
    expect(rank('Black & White', 'white')).toBe(1)
    expect(rank('Zigi', 'ZI')).toBe(0)
  })
})

describe('searchItems', () => {
  const at = (meters: number) => ({ lat: BEER_SHEVA.center.lat + meters / 111_195, lng: BEER_SHEVA.center.lng })
  const venues = [
    venue('הבר הרחוק', at(3000)),
    venue('בר הפינה', at(2000)),
    venue('בר השכונה', at(100)),
    venue('פיצה טובה', { ...at(50), kind: 'restaurant', cuisine: 'pizza;italian' }),
    venue('ביסטרו', { ...at(10), kind: 'restaurant', address: 'רחוב הבר 4' }),
  ]
  const items = buildSections(venues, [], BEER_SHEVA.center, new Date('2026-11-03T18:00:00Z')).all
  const names = (q: string) => searchItems(items, q).map((i) => i.venue.name)

  it('puts name matches first, nearest first among equals, then street and cuisine', () => {
    expect(names('בר')).toEqual(['בר השכונה', 'בר הפינה', 'הבר הרחוק', 'ביסטרו'])
    expect(names('italian')).toEqual(['פיצה טובה'])
    expect(names('  ')).toEqual([])
    expect(names('סושי')).toEqual([])
  })
})
