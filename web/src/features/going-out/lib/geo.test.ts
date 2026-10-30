import { BEER_SHEVA, distanceKm, formatDistance, inBeerSheva, venuePoint } from './geo'

describe('distanceKm', () => {
  it('measures a degree of latitude', () => {
    expect(distanceKm({ lat: 31, lng: 34.8 }, { lat: 32, lng: 34.8 })).toBeCloseTo(111.19, 1)
  })

  it("puts Be'er Sheva's center about 92.7 km from central Tel Aviv (±1%)", () => {
    const km = distanceKm(BEER_SHEVA.center, { lat: 32.0853, lng: 34.7818 })
    expect(Math.abs(km - 92.7) / 92.7).toBeLessThan(0.01)
  })

  it('is zero for the same point and symmetric', () => {
    const a = { lat: 31.2622, lng: 34.8016 }
    expect(distanceKm(a, a)).toBe(0)
    expect(distanceKm(a, BEER_SHEVA.center)).toBeCloseTo(distanceKm(BEER_SHEVA.center, a), 10)
  })
})

describe('inBeerSheva', () => {
  it('knows the city from outside it', () => {
    expect(inBeerSheva(BEER_SHEVA.center)).toBe(true)
    expect(inBeerSheva({ lat: 31.2622, lng: 34.8016 })).toBe(true) // the university
    expect(inBeerSheva({ lat: 32.0853, lng: 34.7818 })).toBe(false) // Tel Aviv
    expect(inBeerSheva({ lat: 31.33, lng: 34.79 })).toBe(false) // north of the box
  })
})

describe('formatDistance', () => {
  it('uses meters under a kilometer and one decimal under ten', () => {
    expect(formatDistance(0.347)).toBe('350 מ׳')
    expect(formatDistance(0.001)).toBe('10 מ׳')
    expect(formatDistance(0.996)).toBe('1.0 ק״מ')
    expect(formatDistance(1.24)).toBe('1.2 ק״מ')
    expect(formatDistance(9.96)).toBe('10 ק״מ')
    expect(formatDistance(23.4)).toBe('23 ק״מ')
  })
})

describe('venuePoint', () => {
  it('is null for a place added without a location', () => {
    expect(venuePoint({ lat: null, lng: null })).toBeNull()
    expect(venuePoint({ lat: 31.24, lng: 34.79 })).toEqual({ lat: 31.24, lng: 34.79 })
  })
})
