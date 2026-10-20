import { createClient } from '@supabase/supabase-js'

// In the demo build (`pnpm build:demo`) vite.config.ts resolves this module to
// src/demo/supabase.ts, an in-browser stand-in with sample data.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && key)

// A placeholder keeps the module importable before .env is filled in; the app
// shows setup instructions instead of making requests in that case.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE: the OAuth redirect carries only a one-time code, useless without
    // the verifier kept in this origin's storage. A misconfigured redirect
    // URL therefore cannot hand a session to another site.
    flowType: 'pkce',
  },
})

export { unwrap } from './unwrap'
