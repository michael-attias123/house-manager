import type { VenueDeal } from '@/lib/db-types'
import { adminDealArgs, draftFromDeal, draftToFields, emptyDraft, validateDraft, type DealDraft } from './draft'

const TODAY = '2026-11-03'
const draft = (extra: Partial<DealDraft> = {}): DealDraft => ({
  ...emptyDraft(7),
  title: 'יין ללא תחתית',
  startsAt: '19:00',
  endsAt: '23:00',
  ...extra,
})

describe('validateDraft', () => {
  it('accepts a complete happy hour (no days = every day)', () => {
    expect(validateDraft(draft(), TODAY)).toEqual({})
  })

  it('asks for a place, a title of 2–60 characters and a day for a special day', () => {
    expect(validateDraft(draft({ venueId: null }), TODAY).venue).toBe('venue_missing')
    expect(validateDraft(draft({ title: ' א ' }), TODAY).title).toBe('title_short')
    expect(validateDraft(draft({ title: 'א'.repeat(61) }), TODAY).title).toBe('title_long')
    expect(validateDraft(draft({ kind: 'special_day' }), TODAY).days).toBe('days_missing')
    expect(validateDraft(draft({ kind: 'special_day', weekdays: [2] }), TODAY)).toEqual({})
  })

  it('needs both times unless it runs all opening hours, and they may not be equal', () => {
    expect(validateDraft(draft({ endsAt: '' }), TODAY).hours).toBe('hours_missing')
    expect(validateDraft(draft({ endsAt: '19:00' }), TODAY).hours).toBe('hours_equal')
    expect(validateDraft(draft({ startsAt: '', endsAt: '', allHours: true }), TODAY)).toEqual({})
    expect(validateDraft(draft({ startsAt: '22:00', endsAt: '02:00' }), TODAY)).toEqual({})
  })

  it('needs a date for an event, and no date in the past', () => {
    expect(validateDraft(draft({ kind: 'event' }), TODAY).date).toBe('date_missing')
    expect(validateDraft(draft({ kind: 'event', date: '2026-11-02' }), TODAY).date).toBe('date_past')
    expect(validateDraft(draft({ kind: 'event', date: TODAY }), TODAY)).toEqual({})
    expect(validateDraft(draft({ date: '2026-11-01' }), TODAY).date).toBe('date_past')
  })

  it('caps the note at 200 characters', () => {
    expect(validateDraft(draft({ note: 'x'.repeat(201) }), TODAY).note).toBe('note_long')
  })
})

describe('draftToFields', () => {
  it('saves an event on one date and without days', () => {
    expect(draftToFields(draft({ kind: 'event', weekdays: [1], date: '2026-11-05' }))).toMatchObject({
      kind: 'event',
      weekdays: [],
      valid_from: '2026-11-05',
      valid_until: '2026-11-05',
    })
  })

  it('saves "valid until" for other deals, sorted days, and nulls for empty fields', () => {
    expect(draftToFields(draft({ kind: 'special_day', weekdays: [4, 2, 2], date: '2026-12-31', note: '  ' }))).toEqual({
      venue_id: 7,
      title: 'יין ללא תחתית',
      kind: 'special_day',
      weekdays: [2, 4],
      starts_at: '19:00',
      ends_at: '23:00',
      valid_from: null,
      valid_until: '2026-12-31',
      note: null,
    })
  })

  it('saves all opening hours as no times, and all seven days as every day', () => {
    expect(draftToFields(draft({ allHours: true, weekdays: [0, 1, 2, 3, 4, 5, 6] }))).toMatchObject({
      starts_at: null,
      ends_at: null,
      weekdays: [],
    })
  })

  it('round-trips a saved deal', () => {
    const saved = {
      venue_id: 3,
      title: 'ערב ג׳אז',
      kind: 'event',
      weekdays: [],
      starts_at: '21:00:00',
      ends_at: '23:30:00',
      valid_from: '2026-11-05',
      valid_until: '2026-11-05',
      note: 'כניסה חופשית',
    } as unknown as VenueDeal
    expect(draftToFields(draftFromDeal(saved))).toEqual({ ...saved, starts_at: '21:00', ends_at: '23:30' })
  })

  it('fills the form from a deal and turns an edit into admin_update_deal arguments', () => {
    const saved = draftFromDeal({
      venue_id: 4, title: 'עסקית', kind: 'happy_hour', weekdays: [0, 1], starts_at: '12:00:00', ends_at: '16:00:00',
      valid_from: null, valid_until: null, note: null,
    })
    expect(saved).toEqual({
      venueId: 4, title: 'עסקית', kind: 'happy_hour', weekdays: [0, 1], allHours: false, startsAt: '12:00',
      endsAt: '16:00', date: '', note: '',
    })
    const edited = draftToFields({ ...saved, title: ' עסקית צהריים ', note: 'עם שתייה' })
    expect(adminDealArgs('d1', edited)).toEqual({
      p_id: 'd1', p_title: 'עסקית צהריים', p_kind: 'happy_hour', p_weekdays: [0, 1], p_starts_at: '12:00',
      p_ends_at: '16:00', p_valid_from: null, p_valid_until: null, p_note: 'עם שתייה',
    })
  })
})
