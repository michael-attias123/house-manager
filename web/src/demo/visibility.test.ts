// The demo client's stand-in for RLS on the going-out tables (client.ts POLICIES).
import { demoClient } from './client'
import { HOUSEHOLD, MICHAEL, TAL, TEST_HOUSEHOLD } from './seed'
import { db, type Row } from './store'

const select = async (table: string) => (await demoClient.from(table).select('*')).data as Row[]

describe('demo going-out visibility', () => {
  it('shows the catalog, the approved deals and this household’s suggestions', async () => {
    const venues = await select('venues')
    expect(venues).toHaveLength(13)
    expect(venues.filter((v) => v.household_id === HOUSEHOLD).map((v) => v.status)).toEqual(['pending'])
    const deals = await select('venue_deals')
    expect(deals.map((d) => d.status).sort()).toEqual([
      'approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'pending', 'rejected',
    ])
  })

  it("hides another household's suggestions and hidden places", async () => {
    db.venues.push({ id: 99, name: 'של טל', kind: 'bar', household_id: TEST_HOUSEHOLD, status: 'pending', hidden: false })
    db.venues.push({ id: 98, name: 'נעלם', kind: 'bar', household_id: null, status: 'approved', hidden: true })
    db.venue_deals.push({ id: 'tal-deal', venue_id: 1, household_id: TEST_HOUSEHOLD, created_by: TAL, status: 'pending' })
    const ids = (await select('venues')).map((v) => v.id)
    expect(ids).not.toContain(98)
    expect(ids).not.toContain(99)
    expect((await select('venue_deals')).map((d) => d.id)).not.toContain('tal-deal')
    // Nor can it be changed from here.
    await demoClient.from('venue_deals').update({ title: 'x' }).eq('id', 'tal-deal')
    expect(db.venue_deals.find((d) => d.id === 'tal-deal')?.title).toBeUndefined()
  })

  it('inserts only pending suggestions of this household, on a place it can see', async () => {
    const base = { venue_id: 1, household_id: HOUSEHOLD, created_by: MICHAEL, title: 'חדש', kind: 'happy_hour' }
    expect((await demoClient.from('venue_deals').insert({ ...base, status: 'approved' })).error?.message).toMatch(
      'row-level security',
    )
    expect((await demoClient.from('venue_deals').insert({ ...base, venue_id: 99 })).error?.message).toMatch(
      'row-level security',
    )
    expect((await demoClient.from('venue_deals').insert({ ...base, status: 'pending' })).error).toBeNull()
    const { data, error } = await demoClient
      .from('venues')
      .insert({ name: 'מקום חדש', kind: 'bar', source: 'community', status: 'pending', household_id: HOUSEHOLD, created_by: MICHAEL })
      .select()
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ id: 100, status: 'pending', hidden: false, lat: null })
  })

  it('never edits an approved deal or a status from the client', async () => {
    const approved = db.venue_deals.find((d) => d.status === 'approved' && d.household_id === HOUSEHOLD)!
    await demoClient.from('venue_deals').update({ title: 'שונה' }).eq('id', approved.id)
    expect(approved.title).toBe('יין ללא תחתית')
    const pending = db.venue_deals.find((d) => d.status === 'pending' && d.household_id === HOUSEHOLD)!
    expect((await demoClient.from('venue_deals').update({ status: 'approved' }).eq('id', pending.id)).error?.message).toMatch(
      'admin_review',
    )
    expect(pending.status).toBe('pending')
  })

  it("deletes the household's own place together with its deals", async () => {
    db.venue_deals.push({ id: 'on-13', venue_id: 13, household_id: HOUSEHOLD, created_by: MICHAEL, status: 'pending' })
    expect((await demoClient.from('venues').delete().eq('id', 13)).error).toBeNull()
    expect(db.venues.some((v) => v.id === 13)).toBe(false)
    expect(db.venue_deals.some((d) => d.id === 'on-13')).toBe(false)
    // A place in the catalog stays.
    await demoClient.from('venues').delete().eq('id', 1)
    expect(db.venues.some((v) => v.id === 1)).toBe(true)
  })
})
