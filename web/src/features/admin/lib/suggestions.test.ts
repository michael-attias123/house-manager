import { draftFromDeal, draftToFields } from '@/features/going-out/lib/draft'
import { venueFields } from '@/features/going-out/lib/venueDraft'
import { suggestionDealFields, suggestionVenueDraft, type AdminSuggestion } from './suggestions'

const row: AdminSuggestion = {
  item_type: 'deal', deal_id: 'd1', venue_id: 13, venue_name: 'בר הגג החדש', venue_kind: 'bar', venue_status: 'pending',
  venue_lat: 31.25, venue_lng: 34.79, venue_address: 'רחוב הדוגמה 12', title: 'קוקטייל 1+1', deal_kind: 'special_day',
  weekdays: [2, 4], starts_at: '21:00:00', ends_at: '01:00:00', valid_from: null, valid_until: '2026-12-31',
  note: 'בבר בלבד', household_id: 'h', household_name: 'הבית שלנו', created_at: '2026-10-29T20:00:00Z',
  similar_venue_id: null, similar_venue_name: null, venue_opening_hours: 'Su-Th 18:00-02:00', venue_website: null,
  venue_phone: '08-0000000', venue_instagram: 'demo.roof',
}

describe('suggestionDealFields', () => {
  it('gives the deal form the row as it is, and saving it unchanged changes nothing', () => {
    const fields = suggestionDealFields(row)
    expect(fields).toEqual({
      venue_id: 13, title: 'קוקטייל 1+1', kind: 'special_day', weekdays: [2, 4], starts_at: '21:00:00',
      ends_at: '01:00:00', valid_from: null, valid_until: '2026-12-31', note: 'בבר בלבד',
    })
    expect(draftToFields(draftFromDeal(fields))).toEqual({ ...fields, starts_at: '21:00', ends_at: '01:00' })
  })
})

describe('suggestionVenueDraft', () => {
  it('keeps the place details the card does not show', () => {
    const draft = suggestionVenueDraft({ ...row, item_type: 'venue', deal_id: null })
    expect(venueFields(draft, draft.point)).toEqual({
      name: 'בר הגג החדש', kind: 'bar', lat: 31.25, lng: 34.79, address: 'רחוב הדוגמה 12', instagram: 'demo.roof',
      website: null, phone: '08-0000000', opening_hours: 'Su-Th 18:00-02:00',
    })
    expect(suggestionVenueDraft({ ...row, venue_lat: null, venue_lng: null }).point).toBeNull()
  })
})
