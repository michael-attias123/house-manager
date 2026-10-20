import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { ErrorBox } from '@/components/ui/Feedback'

export function LoginPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function signInWithGoogle() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
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
      <Button size="lg" variant="secondary" onClick={signInWithGoogle} disabled={busy}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        כניסה עם Google
      </Button>
      {error != null && <ErrorBox error={error} />}
    </div>
  )
}
