import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { ErrorBox } from '@/components/ui/Feedback'
import { useAuth } from './AuthProvider'
import { isEmbeddedBrowser } from './lib/authCallback'

export function LoginPage() {
  const { signInFailure } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const embedded = isEmbeddedBrowser(navigator.userAgent)

  async function signInWithGoogle() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // With the slash, the URL also matches `https://*.<app>.pages.dev/**`
      // in Supabase's Redirect URLs (preview deployments).
      options: { redirectTo: `${window.location.origin}/` },
    })
    // On success the browser leaves for Google; we only get here on failure.
    if (error) {
      setError(error)
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div className="space-y-2 text-center">
        <img src={`${import.meta.env.BASE_URL}pwa-192.png`} alt="" className="mx-auto h-20 w-20 rounded-3xl" />
        <h1 className="text-2xl font-bold">ניהול הבית</h1>
        <p className="text-ink-2">קניות, התחשבנות, חשבונות ומטלות — במקום אחד, לשניכם.</p>
      </div>
      {embedded && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          הדף נפתח בתוך אפליקציה (כמו אינסטגרם או פייסבוק), ו-Google לא מאפשרת להתחבר משם. פתחו את הקישור בספארי או
          בכרום.
        </p>
      )}
      <Button size="lg" variant="secondary" onClick={signInWithGoogle} disabled={busy}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        כניסה עם Google
      </Button>
      {error != null ? (
        <ErrorBox error={error} />
      ) : (
        signInFailure && (
          <div className="space-y-1">
            <ErrorBox error={signInFailure.message} />
            <p dir="ltr" className="text-center text-xs text-ink-3">
              {signInFailure.detail}
            </p>
          </div>
        )
      )}
    </div>
  )
}
