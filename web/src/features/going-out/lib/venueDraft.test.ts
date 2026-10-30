import type { Venue } from '@/lib/db-types'
import { adminVenueArgs, emptyVenueDraft, memberVenueFields, venueDraftFrom, venueFields, venueNameOk } from './venueDraft'

const venue: Venue = {
  id: 7, osm_ref: 'node/7', name: 'בר הדוגמה', kind: 'bar', lat: 31.24, lng: 34.79, address: 'רחוב הדוגמה 7',
  opening_hours: 'Su-Th 18:00-02:00', website: 'https://example.com', phone: null, instagram: 'demo.bar', cuisine: null,
  source: 'osm', household_id: null, created_by: null, status: 'approved', hidden: false, hidden_by_admin: false,
  review_note: null, suggested_household_id: null, admin_edited_at: null, created_at: '', updated_at: '',
}

describe('venue drafts', () => {
  it('starts a new place empty, with the name typed in the search', () => {
    expect(emptyVenueDraft('גג')).toMatchObject({ name: 'גג', kind: 'bar', address: '', point: null })
    expect(venueNameOk(emptyVenueDraft(' א '))).toBe(false)
    expect(venueNameOk(emptyVenueDraft('בר'))).toBe(true)
  })

  it('saves an unchanged place as it was', () => {
    const draft = venueDraftFrom(venue)
    expect(draft.point).toEqual({ lat: 31.24, lng: 34.79 })
    expect(venueFields(draft, draft.point)).toEqual({
      name: 'בר הדוגמה', kind: 'bar', lat: 31.24, lng: 34.79, address: 'רחוב הדוגמה 7', instagram: 'demo.bar',
      website: 'https://example.com', phone: null, opening_hours: 'Su-Th 18:00-02:00',
    })
  })

  it('trims, empties to null, and moves or drops the location', () => {
    const draft = { ...venueDraftFrom(venue), name: ' בר הדוגמה החדש ', address: '  ', phone: ' 08-1234567 ' }
    expect(venueFields(draft, null)).toMatchObject({ name: 'בר הדוגמה החדש', address: null, phone: '08-1234567', lat: null, lng: null })
    expect(venueFields(draft, { lat: 31.25, lng: 34.8 })).toMatchObject({ lat: 31.25, lng: 34.8 })
  })

  it('lets a household write only its own columns', () => {
    const fields = venueFields(venueDraftFrom(venue), null)
    expect(Object.keys(memberVenueFields(fields)).sort()).toEqual(['address', 'instagram', 'kind', 'lat', 'lng', 'name'])
  })

  it('turns an admin edit into admin_update_venue arguments', () => {
    const fields = venueFields({ ...venueDraftFrom(venue), openingHours: 'Mo-Su 17:00-01:00' }, { lat: 31.24, lng: 34.79 })
    expect(adminVenueArgs(7, fields)).toEqual({
      p_id: 7, p_name: 'בר הדוגמה', p_kind: 'bar', p_address: 'רחוב הדוגמה 7', p_opening_hours: 'Mo-Su 17:00-01:00',
      p_website: 'https://example.com', p_phone: null, p_instagram: 'demo.bar', p_lat: 31.24, p_lng: 34.79,
    })
  })
})
