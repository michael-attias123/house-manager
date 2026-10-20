import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { diagnoseSignIn, readAuthCallback, withoutAuthParams, type SignInFailure } from './lib/authCallback'

interface AuthState {
  session: Session | null
  loading: boolean
  /** Why the sign-in redirect that opened this page did not log in. */
  signInFailure: SignInFailure | null
}

const AuthContext = createContext<AuthState>({ session: null, loading: true, signInFailure: null })

function storageWritable(): boolean {
  try {
    const key = 'house-manager-storage-test'
    window.localStorage.setItem(key, key)
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true, signInFailure: null })

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((s) => ({ session, loading: false, signInFailure: session ? null : s.signInFailure }))
    })

    // supabase-js tidies the URL only after a successful exchange; whatever is
    // still there once it has settled is a sign-in that failed, often silently.
    if (readAuthCallback(window.location.href)) {
      void supabase.auth.initialize().then(({ error }) => {
        const callback = readAuthCallback(window.location.href)
        if (!callback) return
        const env = { storageWritable: storageWritable(), standalone: isStandalone() }
        setState((s) => ({ ...s, signInFailure: diagnoseSignIn(callback, error, env) }))
        window.history.replaceState(window.history.state, '', withoutAuthParams(window.location.href))
      })
    }

    return () => data.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
