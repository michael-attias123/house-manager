// The demo client's stand-in for RLS on the going-out tables (client.ts POLICIES).
import { demoClient } from './client'
import { HOUSEHOLD, MICHAEL, TAL, TEST_HOUSEHOLD } from './seed'
import { db, type Row } from './store'

const select = async (table: string) => (await demoClient.from(table).select('*')).data as Row[]

describe('demo going-out visibility', () => {
  it('shows the catalog, the approved deals and this household’s suggestions', async () => {
    const venues = await select('venues')
    expect(venues).toHaveLength(14)
    expect(venues.filter((v) => v.household_id === HOUSEHOLD).map((v) => v.status)).toEqual(['pending'])
    expect(venues.filter((v) => v.suggested_household_id === HOUSEHOLD).map((v) => [v.id, v.status])).toEqual([
      [13, 'pending'],
      [14, 'approved'],
    ])
    const deals = await select('venue_deals')
    expect(deals.map((d) => d.status).sort()).toEqual([
      'approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved', 'approved',
      'pending', 'pending', 'rejected',
    ])
    expect(deals.filter((d) => d.kind === 'member_card').map((d) => d.venue_id).sort()).toEqual([4, 5, 7])
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

  it("keeps each household's stars to itself", async () => {
    db.venue_favorites.push({ household_id: TEST_HOUSEHOLD, venue_id: 2, created_at: '2026-11-01T00:00:00Z' })
    expect((await select('venue_favorites')).map((f) => f.venue_id).sort()).toEqual([1, 8])
    const theirs = { household_id: TEST_HOUSEHOLD, venue_id: 3 }
    expect((await demoClient.from('venue_favorites').insert(theirs)).error?.message).toMatch('row-level security')
    await demoClient.from('venue_favorites').delete().eq('household_id', TEST_HOUSEHOLD).eq('venue_id', 2)
    expect(db.venue_favorites.some((f) => f.household_id === TEST_HOUSEHOLD)).toBe(true)
    // Starring twice keeps one row.
    const ours = { household_id: HOUSEHOLD, venue_id: 1 }
    await demoClient.from('venue_favorites').upsert(ours, { ignoreDuplicates: true })
    expect(db.venue_favorites.filter((f) => f.household_id === HOUSEHOLD && f.venue_id === 1)).toHaveLength(1)
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
    expect(data).toMatchObject({ id: 100, status: 'pending', hidden: false, lat: null, suggested_household_id: HOUSEHOLD })
    // The trigger sets it, whatever the client sends.
    const other = await demoClient
      .from('venues')
      .insert({
        name: 'עוד מקום', kind: 'bar', source: 'community', status: 'pending', household_id: HOUSEHOLD, created_by: MICHAEL,
        suggested_household_id: TEST_HOUSEHOLD,
      })
      .select()
      .single()
    expect(other.data).toMatchObject({ suggested_household_id: HOUSEHOLD, admin_edited_at: null, hidden_by_admin: false })
  })

  it('lists "ההצעות שלי" with or(): the household’s places, approved ones included', async () => {
    const { data, error } = await demoClient
      .from('venues')
      .select('*')
      .or(`household_id.eq.${HOUSEHOLD},suggested_household_id.eq.${HOUSEHOLD}`)
    expect(error).toBeNull()
    expect((data as Row[]).map((v) => v.id).sort((a, b) => a - b)).toEqual([13, 14, 100, 101])
    const none = await demoClient.from('venues').select('*').or('household_id.is.null').eq('source', 'community')
    expect((none.data as Row[]).map((v) => v.id)).toEqual([14])
    expect((await demoClient.from('venues').select('*').or('name.like.x')).error?.message).toMatch('logic tree')
  })

  it('sends an edited rejected suggestion for approval again, keeping the admin’s note', async () => {
    const rejected = db.venue_deals.find((d) => d.status === 'rejected' && d.household_id === HOUSEHOLD)!
    expect(rejected.review_note).toBeTruthy()
    const note = rejected.review_note
    // Saving it unchanged is not a resubmission.
    await demoClient.from('venue_deals').update({ title: rejected.title }).eq('id', rejected.id)
    expect(rejected.status).toBe('rejected')
    expect((await demoClient.from('venue_deals').update({ title: 'כניסה חינם עד 23:30' }).eq('id', rejected.id)).error).toBeNull()
    expect(rejected).toMatchObject({ status: 'pending', reviewed_by: null, reviewed_at: null, review_note: note })
    // A pending one stays pending.
    await demoClient.from('venue_deals').update({ note: 'עם תעודה' }).eq('id', rejected.id)
    expect(rejected.status).toBe('pending')

    const place = db.venues.find((v) => v.id === 13)!
    Object.assign(place, { status: 'rejected', review_note: 'חסרה כתובת' })
    await demoClient.from('venues').update({ address: 'רחוב הדוגמה 14' }).eq('id', 13)
    expect(place).toMatchObject({ status: 'pending', review_note: 'חסרה כתובת', address: 'רחוב הדוגמה 14' })
    // The server-set columns stay the server's.
    expect((await demoClient.from('venues').update({ hidden_by_admin: true }).eq('id', 13)).error?.message).toMatch('admin_review')
    expect((await demoClient.from('venues').update({ suggested_household_id: null }).eq('id', 13)).error).not.toBeNull()
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
