import { supabaseTarget } from './supabaseTarget'

const BASE = 'https://abc.supabase.co'

describe('supabaseTarget', () => {
  it('names tables, functions and auth endpoints, without the query string', () => {
    expect(supabaseTarget(`${BASE}/rest/v1/shopping_items?select=*&household_id=eq.42`)).toBe(
      'rest:shopping_items',
    )
    expect(supabaseTarget(`${BASE}/rest/v1/rpc/save_expense`)).toBe('rpc:save_expense')
    expect(supabaseTarget(`${BASE}/rest/v1/rpc/match_candidates?p_name=%D7%97%D7%9C%D7%91`)).toBe(
      'rpc:match_candidates',
    )
    expect(supabaseTarget(`${BASE}/auth/v1/token?grant_type=refresh_token`)).toBe('auth:token')
    expect(supabaseTarget(`${BASE}/auth/v1/user`)).toBe('auth:user')
    expect(supabaseTarget(`${BASE}/auth/v1/admin/users/3f2b8c1e-9d4a-4b7e-8f00-1a2b3c4d5e6f`)).toBe(
      'auth:admin',
    )
  })

  it('returns null for anything else', () => {
    expect(supabaseTarget(`${BASE}/rest/v1/`)).toBeNull()
    expect(supabaseTarget(`${BASE}/rest/v1/rpc/`)).toBeNull()
    expect(supabaseTarget(`${BASE}/realtime/v1/websocket?apikey=x`)).toBeNull()
    expect(supabaseTarget(`${BASE}/functions/v1/send-push`)).toBeNull()
    expect(supabaseTarget(`${BASE}/storage/v1/object/x`)).toBeNull()
    expect(supabaseTarget('https://house.pages.dev/assets/index.js')).toBeNull()
    expect(supabaseTarget('/rest/v1/expenses')).toBeNull()
    expect(supabaseTarget('not a url')).toBeNull()
  })

  it('refuses names that are not plain identifiers', () => {
    expect(supabaseTarget(`${BASE}/rest/v1/%D7%97%D7%9C%D7%91`)).toBeNull()
    expect(supabaseTarget(`${BASE}/rest/v1/a%20b`)).toBeNull()
    expect(supabaseTarget(`${BASE}/rest/v1/${'x'.repeat(64)}`)).toBeNull()
  })

  it('with a base, accepts only that project', () => {
    expect(supabaseTarget(`${BASE}/rest/v1/expenses`, BASE)).toBe('rest:expenses')
    expect(supabaseTarget('https://other.supabase.co/rest/v1/expenses', BASE)).toBeNull()
  })
})
