// Replaces src/lib/supabase.ts in the demo build (see vite.config.ts): the
// app runs entirely in the browser on sample data.
import type { SupabaseClient } from '@supabase/supabase-js'
import { demoClient } from './client'
import { autoPayDueBills } from './rpc'
import { save } from './store'

export { unwrap } from '@/lib/unwrap'

export const isSupabaseConfigured = true

autoPayDueBills()
save()

export const supabase = demoClient as unknown as SupabaseClient
