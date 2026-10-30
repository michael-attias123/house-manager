import { demoClient } from './client'
import { HOUSEHOLD, MICHAEL, TAL, TEST_HOUSEHOLD, YAHALI } from './seed'
import { db, type Row } from './store'

// The going-out ports, on rows of their own (the demo seed may have others).
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

const venue = (id: number, name: string, patch: Row = {}): Row => ({
  id, osm_ref: null, name, kind: 'bar', lat: null, lng: null, address: null, opening_hours: null, website: null,
  phone: null, instagram: null, cuisine: null, source: 'osm', household_id: null, created_by: null, status: 'approved',
  hidden: false, hidden_by_admin: false, review_note: null, suggested_household_id: null, admin_edited_at: null,
  updated_at: hoursAgo(100), ...patch,
})

const suggested = (id: number, name: string, householdId: string, createdBy: string, hours: number, patch: Row = {}) =>
  venue(id, name, {
    source: 'community', household_id: householdId, suggested_household_id: householdId, created_by: createdBy,
    status: 'pending', updated_at: hoursAgo(hours), ...patch,
  })

const deal = (id: string, venueId: number, householdId: string | null, status: string, hours: number, patch: Row = {}): Row => ({
  id, venue_id: venueId, household_id: householdId, created_by: householdId === HOUSEHOLD ? YAHALI : TAL,
  title: `דיל ${id}`, kind: 'happy_hour', weekdays: [], starts_at: '17:00:00', ends_at: '19:00:00', valid_from: null,
  valid_until: null, note: null, status, reviewed_by: null, reviewed_at: null, review_note: null,
  last_confirmed_at: hoursAgo(hours), created_at: hoursAgo(hours), ...patch,
})

beforeEach(() => {
  db.venues = [
    venue(1, 'בר הדוגמה', { lat: 31.2405, lng: 34.788 }),
    venue(2, 'פאב השכונה', { kind: 'pub', lat: 31.25, lng: 34.795 }),
    // The same name as 1 once normalized.
    suggested(10, 'בר "הדוגמה"', HOUSEHOLD, YAHALI, 6),
    // About 25 m from 2.
    suggested(11, 'הפינה החדשה', TEST_HOUSEHOLD, TAL, 4, { lat: 31.2502, lng: 34.795 }),
    suggested(12, 'מקום רחוק', HOUSEHOLD, YAHALI, 1, { lat: 31.27, lng: 34.8 }),
  ]
  db.venue_deals = [
    deal('d1', 1, HOUSEHOLD, 'pending', 5, { kind: 'special_day', weekdays: [2], title: 'יין ללא תחתית' }),
    deal('d2', 10, HOUSEHOLD, 'pending', 3),
    deal('d3', 2, TEST_HOUSEHOLD, 'approved', 13),
    deal('d4', 2, TEST_HOUSEHOLD, 'pending', 2),
    deal('d5', 11, TEST_HOUSEHOLD, 'pending', 4),
  ]
})

const rpc = (name: string, args: Record<string, unknown> = {}) => demoClient.rpc(name, args)

/** admin_update_* arguments that write a row back as it is. */
const dealArgs = (id: string) => {
  const d = db.venue_deals.find((x) => x.id === id)!
  return {
    p_id: id, p_title: d.title, p_kind: d.kind, p_weekdays: d.weekdays, p_starts_at: d.starts_at, p_ends_at: d.ends_at,
    p_valid_from: d.valid_from, p_valid_until: d.valid_until, p_note: d.note,
  }
}
const venueArgs = (id: number) => {
  const v = db.venues.find((x) => x.id === id)!
  return {
    p_id: id, p_name: v.name, p_kind: v.kind, p_address: v.address, p_opening_hours: v.opening_hours, p_website: v.website,
    p_phone: v.phone, p_instagram: v.instagram, p_lat: v.lat, p_lng: v.lng,
  }
}
const rpcError = async (name: string, args: Record<string, unknown>) => (await rpc(name, args)).error?.message
const dealRow = (id: string) => db.venue_deals.find((d) => d.id === id)!
const venueRow = (id: number) => db.venues.find((v) => v.id === id)

type Suggestion = { item_type: string; deal_id: string | null; venue_id: number; [column: string]: unknown }
const suggestions = async () => (await rpc('admin_list_suggestions')).data as Suggestion[]
const keys = (rows: Suggestion[]) => rows.map((s) => s.deal_id ?? s.venue_id)

describe('demo going-out suggestions', () => {
  it('lists pending deals and places, oldest first, with the household and possible duplicates', async () => {
    const rows = await suggestions()
    expect(keys(rows)).toEqual([10, 'd1', 11, 'd5', 'd2', 'd4', 12])
    const row = (key: string | number) => rows.find((s) => (s.deal_id ?? s.venue_id) === key)!
    expect(row('d1')).toMatchObject({
      item_type: 'deal', venue_id: 1, venue_name: 'בר הדוגמה', venue_status: 'approved', title: 'יין ללא תחתית',
      deal_kind: 'special_day', weekdays: [2], starts_at: '17:00:00', household_name: 'הבית שלנו', similar_venue_id: null,
    })
    expect(row(10)).toMatchObject({ item_type: 'venue', deal_id: null, title: null, similar_venue_id: 1, similar_venue_name: 'בר הדוגמה' })
    expect(row(11)).toMatchObject({ household_name: 'דירת ניסיון', similar_venue_id: 2, similar_venue_name: 'פאב השכונה' })
    expect(row(12).similar_venue_id).toBeNull()
    // A deal on a suggested place carries the place's duplicate hint too.
    expect(row('d2')).toMatchObject({ venue_status: 'pending', similar_venue_id: 1 })
  })

  it('approves and rejects a deal', async () => {
    expect(await rpcError('admin_review_deal', { p_id: 'd1', p_approve: true })).toBeUndefined()
    expect(dealRow('d1')).toMatchObject({ status: 'approved', reviewed_by: MICHAEL, review_note: null, household_id: HOUSEHOLD })
    expect(dealRow('d1').reviewed_at).toBeTruthy()

    expect(await rpcError('admin_review_deal', { p_id: 'd4', p_approve: false, p_note: '  כבר לא בתוקף ' })).toBeUndefined()
    expect(dealRow('d4')).toMatchObject({ status: 'rejected', review_note: 'כבר לא בתוקף', household_id: TEST_HOUSEHOLD })
    expect(keys(await suggestions())).not.toContain('d1')
    expect(keys(await suggestions())).not.toContain('d4')
    expect(await rpcError('admin_review_deal', { p_id: 'nope', p_approve: true })).toBe('not found')
  })

  it('approves a deal on a suggested place only once the place is approved', async () => {
    expect(await rpcError('admin_review_deal', { p_id: 'd2', p_approve: true })).toBe('venue not approved')
    expect(dealRow('d2').status).toBe('pending')
    // Rejecting it is fine.
    expect(await rpcError('admin_review_deal', { p_id: 'd5', p_approve: false })).toBeUndefined()

    expect(await rpcError('admin_review_venue', { p_id: 10, p_approve: true })).toBeUndefined()
    expect(venueRow(10)).toMatchObject({ status: 'approved', household_id: null, created_by: YAHALI })
    expect(await rpcError('admin_review_deal', { p_id: 'd2', p_approve: true })).toBeUndefined()
    expect(dealRow('d2').status).toBe('approved')

    expect(await rpcError('admin_review_venue', { p_id: 12, p_approve: false, p_note: 'לא בבאר שבע' })).toBeUndefined()
    expect(venueRow(12)).toMatchObject({ status: 'rejected', household_id: HOUSEHOLD, review_note: 'לא בבאר שבע' })
    // A place everyone sees cannot go back to one household (the check constraint).
    expect(await rpcError('admin_review_venue', { p_id: 1, p_approve: false })).toMatch('check constraint')
  })

  it('merges a duplicate place into the approved one', async () => {
    expect(await rpcError('admin_merge_venue', { p_from: 10, p_into: 12 })).toBe('venue not approved')
    expect(await rpcError('admin_merge_venue', { p_from: 1, p_into: 2 })).toBe('not found')
    expect(await rpcError('admin_merge_venue', { p_from: 11, p_into: 2 })).toBeUndefined()
    expect(venueRow(11)).toBeUndefined()
    expect(dealRow('d5')).toMatchObject({ venue_id: 2, status: 'pending' })
    const rows = await suggestions()
    expect(keys(rows)).not.toContain(11)
    expect(rows.find((s) => s.deal_id === 'd5')).toMatchObject({ venue_status: 'approved', venue_name: 'פאב השכונה' })
  })

  it('keeps every admin port away from other users', async () => {
    localStorage.setItem('house-manager-demo-user', YAHALI)
    try {
      expect((await rpc('is_admin')).data).toBe(false)
      expect(await rpcError('admin_list_suggestions', {})).toBe('admin only')
      expect(await rpcError('admin_review_deal', { p_id: 'd1', p_approve: true })).toBe('admin only')
      expect(await rpcError('admin_review_venue', { p_id: 10, p_approve: true })).toBe('admin only')
      expect(await rpcError('admin_merge_venue', { p_from: 11, p_into: 2 })).toBe('admin only')
      expect(await rpcError('admin_update_deal', { ...dealArgs('d3'), p_title: 'שלי' })).toBe('admin only')
      expect(await rpcError('admin_update_venue', { ...venueArgs(1), p_name: 'שלי' })).toBe('admin only')
      expect(await rpcError('admin_delete_deal', { p_id: 'd3' })).toBe('admin only')
      expect(await rpcError('admin_hide_venue', { p_id: 1, p_hidden: true })).toBe('admin only')
      expect(dealRow('d1').status).toBe('pending')
      expect(dealRow('d3').title).toBe('דיל d3')
      expect(venueRow(1)).toMatchObject({ name: 'בר הדוגמה', hidden: false, admin_edited_at: null })
      expect(venueRow(11)).toBeDefined()
    } finally {
      localStorage.removeItem('house-manager-demo-user')
    }
  })

  it('edits any deal without changing its status', async () => {
    const args = { ...dealArgs('d3'), p_title: ' בירה 1+1 ', p_weekdays: [4, 5], p_starts_at: '21:00', p_ends_at: '01:00', p_note: ' ' }
    expect(await rpcError('admin_update_deal', args)).toBeUndefined()
    expect(dealRow('d3')).toMatchObject({
      title: 'בירה 1+1', weekdays: [4, 5], starts_at: '21:00', ends_at: '01:00', note: null, status: 'approved',
      household_id: TEST_HOUSEHOLD, venue_id: 2,
    })
    // A pending one stays pending, for the review that follows.
    expect(await rpcError('admin_update_deal', { ...dealArgs('d4'), p_title: 'מתוקן' })).toBeUndefined()
    expect(dealRow('d4')).toMatchObject({ title: 'מתוקן', status: 'pending' })

    expect(await rpcError('admin_update_deal', { ...dealArgs('d3'), p_title: 'א' })).toMatch('check constraint')
    expect(await rpcError('admin_update_deal', { ...dealArgs('d3'), p_kind: 'party' })).toMatch('check constraint')
    expect(await rpcError('admin_update_deal', { ...dealArgs('d3'), p_starts_at: '20:00', p_ends_at: '20:00:00' })).toMatch(
      'check constraint',
    )
    expect(
      await rpcError('admin_update_deal', { ...dealArgs('d3'), p_valid_from: '2026-11-05', p_valid_until: '2026-11-01' }),
    ).toMatch('check constraint')
    expect(dealRow('d3').title).toBe('בירה 1+1')
    expect(await rpcError('admin_update_deal', { ...dealArgs('d3'), p_id: 'nope' })).toBe('not found')
  })

  it('edits any place, marks it as edited by an admin, and keeps its status', async () => {
    const args = { ...venueArgs(1), p_name: ' בר הדוגמה הישן ', p_opening_hours: 'Mo-Su 18:00-02:00', p_phone: '08-1111111', p_address: '' }
    expect(await rpcError('admin_update_venue', args)).toBeUndefined()
    expect(venueRow(1)).toMatchObject({
      name: 'בר הדוגמה הישן', opening_hours: 'Mo-Su 18:00-02:00', phone: '08-1111111', address: null,
      status: 'approved', source: 'osm', lat: 31.2405,
    })
    expect(Date.now() - Date.parse(venueRow(1)!.admin_edited_at)).toBeLessThan(60_000)

    expect(await rpcError('admin_update_venue', { ...venueArgs(12), p_kind: 'pub', p_lat: null, p_lng: null })).toBeUndefined()
    expect(venueRow(12)).toMatchObject({ kind: 'pub', lat: null, lng: null, status: 'pending', household_id: HOUSEHOLD })
    // It's still waiting, with the new details.
    expect((await suggestions()).find((s) => s.venue_id === 12 && s.item_type === 'venue')).toMatchObject({ venue_kind: 'pub' })

    expect(await rpcError('admin_update_venue', { ...venueArgs(1), p_name: '  ' })).toMatch('check constraint')
    expect(await rpcError('admin_update_venue', { ...venueArgs(1), p_lat: 31.2, p_lng: null })).toMatch('check constraint')
    expect(await rpcError('admin_update_venue', { ...venueArgs(1), p_id: 999 })).toBe('not found')
  })

  it('gives the admin list the rest of each place, so an edit keeps it', async () => {
    Object.assign(venueRow(10)!, { opening_hours: 'Th 20:00-02:00', instagram: 'demo.quote', phone: null, website: 'example.com' })
    expect((await suggestions()).find((s) => s.item_type === 'venue' && s.venue_id === 10)).toMatchObject({
      venue_opening_hours: 'Th 20:00-02:00', venue_instagram: 'demo.quote', venue_phone: null, venue_website: 'example.com',
    })
  })

  it('deletes a deal, and hides and shows a place for everyone', async () => {
    expect(await rpcError('admin_delete_deal', { p_id: 'd3' })).toBeUndefined()
    expect(db.venue_deals.map((d) => d.id)).not.toContain('d3')
    expect(await rpcError('admin_delete_deal', { p_id: 'd3' })).toBe('not found')

    expect(await rpcError('admin_hide_venue', { p_id: 2, p_hidden: true })).toBeUndefined()
    expect(venueRow(2)).toMatchObject({ hidden: true, hidden_by_admin: true })
    expect(((await demoClient.from('venues').select('*')).data as Row[]).map((v) => v.id)).not.toContain(2)
    expect(await rpcError('admin_hide_venue', { p_id: 2, p_hidden: false })).toBeUndefined()
    expect(venueRow(2)).toMatchObject({ hidden: false, hidden_by_admin: false })
    expect(await rpcError('admin_hide_venue', { p_id: 999, p_hidden: true })).toBe('not found')
  })

  it('confirms a deal at most once per 12 hours, if the caller can see it', async () => {
    expect(await rpcError('confirm_deal', { p_id: 'd3' })).toBeUndefined()
    const confirmed = dealRow('d3').last_confirmed_at
    expect(Date.now() - Date.parse(confirmed)).toBeLessThan(60_000)

    dealRow('d3').last_confirmed_at = hoursAgo(11)
    const earlier = dealRow('d3').last_confirmed_at
    expect(await rpcError('confirm_deal', { p_id: 'd3' })).toBeUndefined()
    expect(dealRow('d3').last_confirmed_at).toBe(earlier)

    // Another household's pending deal is not visible; the caller's own is.
    expect(await rpcError('confirm_deal', { p_id: 'd4' })).toBe('not found')
    dealRow('d2').last_confirmed_at = hoursAgo(20)
    expect(await rpcError('confirm_deal', { p_id: 'd2' })).toBeUndefined()
    expect(Date.now() - Date.parse(dealRow('d2').last_confirmed_at)).toBeLessThan(60_000)
  })

  it('moves a removed member’s suggestions to the placeholder', async () => {
    expect(await rpcError('admin_remove_member', { p_household_id: HOUSEHOLD, p_user_id: YAHALI })).toBeUndefined()
    const placeholder = db.household_members.find((m) => m.household_id === HOUSEHOLD && m.is_placeholder)!.user_id
    expect(dealRow('d1').created_by).toBe(placeholder)
    expect(venueRow(10)?.created_by).toBe(placeholder)
    expect(dealRow('d3').created_by).toBe(TAL)
  })

  it('keeps approved deals when their household is deleted', async () => {
    db.venues.push(venue(20, 'מקום שאושר', { source: 'community', suggested_household_id: TEST_HOUSEHOLD }))
    expect(await rpcError('admin_delete_household', { p_household_id: TEST_HOUSEHOLD })).toBeUndefined()
    expect(dealRow('d3')).toMatchObject({ status: 'approved', household_id: null })
    expect(db.venue_deals.map((d) => d.id)).not.toContain('d4')
    expect(venueRow(11)).toBeUndefined()
    // A place it added and that was approved stays, without its household.
    expect(venueRow(20)).toMatchObject({ status: 'approved', suggested_household_id: null })
    // Still listed for everyone, and a review can no longer hand it back to a household.
    expect(await rpcError('admin_review_deal', { p_id: 'd3', p_approve: false })).toMatch('check constraint')
  })
})
