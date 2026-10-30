const DB_KEY = 'house-manager-demo-db-v4'
const SEEDED_KEY = 'house-manager-demo-seeded'

/** Loads store.ts afresh over the given saved data. */
async function loadWith(saved: Record<string, unknown[]>, seeded?: string[]) {
  localStorage.clear()
  localStorage.setItem(DB_KEY, JSON.stringify(saved))
  if (seeded) localStorage.setItem(SEEDED_KEY, JSON.stringify(seeded))
  vi.resetModules()
  return (await import('./store')).db
}

describe('demo data saved before a feature existed', () => {
  afterAll(() => localStorage.clear())

  it('gets the sample rows of a missing table', async () => {
    const db = await loadWith({ list_items: [{ id: 'mine' }] })
    expect(db.venues.length).toBeGreaterThan(0)
    expect(db.list_items).toEqual([{ id: 'mine' }])
  })

  it('gets them for a table saved empty before seeding was recorded', async () => {
    const db = await loadWith({ list_items: [{ id: 'mine' }], venues: [], venue_deals: [] })
    expect(db.venues.length).toBeGreaterThan(0)
    expect(db.venue_deals.length).toBeGreaterThan(0)
    // And keeps them on the next load.
    expect(JSON.parse(localStorage.getItem(DB_KEY)!).venues.length).toBe(db.venues.length)
  })

  it('leaves a table that was seeded and then emptied alone', async () => {
    const db = await loadWith({ list_items: [], venues: [] }, ['list_items', 'venues'])
    expect(db.venues).toEqual([])
    expect(db.list_items).toEqual([])
  })
})
