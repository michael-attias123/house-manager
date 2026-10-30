import { PREF_KEYS, prefKeysFor, prefsOrDefault } from './prefs'

describe('notification prefs', () => {
  it('starts with everything off', () => {
    const prefs = prefsOrDefault(null, 'u1')
    expect(prefs.user_id).toBe('u1')
    expect(PREF_KEYS.map((k) => prefs[k])).toEqual([false, false, false, false, false, false])
  })

  it('keeps a saved row as is', () => {
    const row = {
      user_id: 'u1',
      bills: true,
      chores: false,
      partner: true,
      weekly: false,
      going_out: true,
      admin: false,
    }
    expect(prefsOrDefault(row, 'u1')).toBe(row)
  })

  it('offers the admin kind to admins only', () => {
    expect(prefKeysFor(false)).toEqual(['bills', 'chores', 'partner', 'weekly', 'going_out'])
    expect(prefKeysFor(true)).toEqual(['bills', 'chores', 'partner', 'weekly', 'going_out', 'admin'])
  })
})
