import type { Venue, VenueDeal } from '@/lib/db-types'
import { adminReply, canEdit, groupByStatus, mySuggestions, summaryParts } from './mine'

const HOME = 'home'

const venue = (id: number, extra: Partial<Venue> = {}): Venue => ({
  id, osm_ref: null, name: `מקום ${id}`, kind: 'bar', lat: null, lng: null, address: null, opening_hours: null,
  website: null, phone: null, instagram: null, cuisine: null, source: 'osm', household_id: null, created_by: null,
  status: 'approved', hidden: false, hidden_by_admin: false, review_note: null, suggested_household_id: null,
  admin_edited_at: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...extra,
})

const deal = (id: string, venueId: number, status: VenueDeal['status'], created: string, extra: Partial<VenueDeal> = {}): VenueDeal => ({
  id, venue_id: venueId, household_id: HOME, created_by: null, title: `דיל ${id}`, kind: 'happy_hour', weekdays: [],
  starts_at: null, ends_at: null, valid_from: null, valid_until: null, note: null, status, reviewed_by: null,
  reviewed_at: null, review_note: null, last_confirmed_at: created, created_at: created, ...extra,
})

const catalog = [venue(1), venue(2)]
const suggestedPlace = venue(13, { source: 'community', household_id: HOME, suggested_household_id: HOME, status: 'pending', created_at: '2026-10-28T00:00:00Z' })
const approvedPlace = venue(14, { source: 'community', suggested_household_id: HOME, created_at: '2026-10-10T00:00:00Z' })
const mine = {
  venues: [suggestedPlace, approvedPlace],
  deals: [
    deal('a', 1, 'approved', '2026-10-05T00:00:00Z'),
    deal('p', 13, 'pending', '2026-10-29T00:00:00Z'),
    deal('r', 2, 'rejected', '2026-10-20T00:00:00Z', { review_note: 'לא מצאנו את הדיל' }),
    deal('gone', 99, 'pending', '2026-10-21T00:00:00Z'),
  ],
}

describe('mySuggestions', () => {
  const items = mySuggestions(mine, catalog)

  it('lists deals and places together, newest first, each with its place', () => {
    expect(items.map((i) => i.key)).toEqual(['deal:p', 'venue:13', 'deal:gone', 'deal:r', 'venue:14', 'deal:a'])
    expect(items[0].venue?.name).toBe('מקום 13')
    expect(items.find((i) => i.key === 'deal:r')).toMatchObject({ venue: { id: 2 }, reviewNote: 'לא מצאנו את הדיל' })
    // A place that can't be seen any more (hidden) is null; the deal still shows.
    expect(items.find((i) => i.key === 'deal:gone')?.venue).toBeNull()
    expect(items.find((i) => i.key === 'venue:14')).toMatchObject({ deal: null, status: 'approved' })
  })

  it('groups by status for the three tabs, and counts them for Settings', () => {
    const groups = groupByStatus(items)
    expect(groups.pending.map((i) => i.key)).toEqual(['deal:p', 'venue:13', 'deal:gone'])
    expect(groups.approved.map((i) => i.key)).toEqual(['venue:14', 'deal:a'])
    expect(groups.rejected.map((i) => i.key)).toEqual(['deal:r'])
    expect(summaryParts(groups)).toEqual([[3, 'ממתינות'], [2, 'אושרו'], [1, 'לא אושרה']])
    expect(summaryParts(groupByStatus([items[0]]))).toEqual([[1, 'ממתינה']])
    expect(summaryParts(groupByStatus([]))).toEqual([])
  })

  it('edits only what is not approved', () => {
    expect(['pending', 'approved', 'rejected'].map((status) => canEdit({ status: status as VenueDeal['status'] }))).toEqual([
      true, false, true,
    ])
  })
})

describe('adminReply', () => {
  it("shows the admin's note on a rejected suggestion, or says there was none", () => {
    expect(adminReply({ status: 'rejected', reviewNote: ' כבר לא בתוקף ' })).toEqual({ label: 'תגובת המנהל', text: 'כבר לא בתוקף' })
    expect(adminReply({ status: 'rejected', reviewNote: null })).toEqual({ label: null, text: 'לא אושר, בלי הערה' })
  })

  it('keeps the previous note while a resubmitted one waits, and nothing otherwise', () => {
    expect(adminReply({ status: 'pending', reviewNote: 'חסר יום' })).toEqual({ label: 'התגובה הקודמת של המנהל', text: 'חסר יום' })
    expect(adminReply({ status: 'pending', reviewNote: null })).toBeNull()
    expect(adminReply({ status: 'approved', reviewNote: 'תודה!' })).toEqual({ label: 'תגובת המנהל', text: 'תודה!' })
    expect(adminReply({ status: 'approved', reviewNote: '  ' })).toBeNull()
  })
})
