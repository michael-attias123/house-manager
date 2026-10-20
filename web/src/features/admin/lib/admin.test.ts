import type { AdminHouseholdMember } from '@/lib/db-types'
import { adminErrorMessage, hasActiveMember, isValidEmail, memberStatus, normalizeEmail, summarizeIngest } from './admin'

const member = (patch: Partial<AdminHouseholdMember>): AdminHouseholdMember => ({
  user_id: 'u',
  display_name: 'דנה',
  is_placeholder: false,
  email: 'dana@example.com',
  ...patch,
})

describe('emails', () => {
  it('normalizes like the server', () => {
    expect(normalizeEmail('  Friend@Example.COM ')).toBe('friend@example.com')
  })

  it('accepts addresses and rejects the rest', () => {
    expect(isValidEmail(' Friend@Example.com ')).toBe(true)
    expect(isValidEmail('a.b+tag@gmail.co.il')).toBe(true)
    for (const bad of ['nope', 'a@b', '@gmail.com', 'a b@gmail.com', 'a@@gmail.com', '']) {
      expect(isValidEmail(bad)).toBe(false)
    }
  })
})

describe('adminErrorMessage', () => {
  it('translates server errors, also inside a longer message', () => {
    expect(adminErrorMessage('admin only')).toBe('הפעולה זמינה רק עם הרשאת ניהול.')
    expect(adminErrorMessage('permission denied for function admin_list_users')).toBe('הפעולה זמינה רק עם הרשאת ניהול.')
    expect(adminErrorMessage('ERROR: allowlist cannot be empty')).toMatch('הכתובת האחרונה')
    expect(adminErrorMessage('cannot remove your own email')).toBe('אי אפשר להסיר את הכתובת שלך.')
    expect(adminErrorMessage('cannot remove yourself')).toBe('אי אפשר להסיר את עצמך.')
    expect(adminErrorMessage('placeholder has history')).toMatch('רישומים')
    expect(adminErrorMessage('not found')).toBe('לא נמצא, אולי כבר נמחק.')
  })

  it('passes unknown errors through', () => {
    expect(adminErrorMessage('Failed to fetch')).toBe('Failed to fetch')
  })
})

describe('members', () => {
  it('flags a household without a real account', () => {
    expect(hasActiveMember([member({}), member({ is_placeholder: true, email: null })])).toBe(true)
    expect(hasActiveMember([member({ email: null }), member({ is_placeholder: true, email: null })])).toBe(false)
    expect(hasActiveMember([])).toBe(false)
  })

  it('tells placeholders from deleted accounts', () => {
    expect(memberStatus(member({}))).toBe('active')
    expect(memberStatus(member({ is_placeholder: true, email: null }))).toBe('placeholder')
    expect(memberStatus(member({ email: null }))).toBe('deleted')
  })
})

describe('summarizeIngest', () => {
  it('counts branches, items and problems', () => {
    const summary = summarizeIngest({
      rami_levy: {
        stores: {
          '39': { name: 'רמי לוי באר שבע', file: 'PriceFull.xml', items: 5200, prices_written: 12 },
          '41': { name: 'רמי לוי ביג', items: 4800 },
        },
      },
      shufersal: { stores: { '413': { name: 'שופרסל דיל', error: 'no PriceFull file' } } },
      osher_ad: { stores: {}, error: 'no stores found in city (or Stores file unavailable)' },
    })
    expect(summary).toEqual({
      storesOk: 2,
      storesFailed: 1,
      items: 10000,
      problems: [
        { chain: 'shufersal', store: 'שופרסל דיל', error: 'no PriceFull file' },
        { chain: 'osher_ad', error: 'no stores found in city (or Stores file unavailable)' },
      ],
    })
  })

  it('tolerates empty and odd stats', () => {
    const empty = { storesOk: 0, storesFailed: 0, items: 0, problems: [] }
    expect(summarizeIngest({})).toEqual(empty)
    expect(summarizeIngest(null)).toEqual(empty)
    expect(summarizeIngest({ x: 3, y: { stores: [1] }, z: { stores: { a: null, b: { items: 'n/a' } } } })).toEqual({
      ...empty,
      storesOk: 1,
    })
  })
})
