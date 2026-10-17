import { useState, type FormEvent } from 'react'
import { Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'

/**
 * Email one-time code (works inside an installed PWA, unlike magic links that
 * open the browser) plus Google sign-in.
 */
export function LoginPage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setError(error)
    else setStep('code')
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (error) setError(new Error('הקוד שגוי או שפג תוקפו'))
  }

  async function signInWithGoogle() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) setError(error)
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6">
      <div className="space-y-2 text-center">
        <img src="/pwa-192.png" alt="" className="mx-auto h-20 w-20 rounded-3xl" />
        <h1 className="text-2xl font-bold">ניהול הבית</h1>
        <p className="text-ink-2">קניות, התחשבנות, חשבונות ומטלות — במקום אחד, לשניכם.</p>
      </div>

      {step === 'email' ? (
        <form onSubmit={sendCode} className="space-y-4">
          <Field label="אימייל">
            {(id) => (
              <Input
                id={id}
                type="email"
                dir="ltr"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            )}
          </Field>
          <Button type="submit" className="w-full" disabled={busy || !email}>
            <Mail size={18} />
            שלחו לי קוד כניסה
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4">
          <p className="text-sm text-ink-2">
            שלחנו קוד ל-<span dir="ltr">{email}</span>. הקלידו אותו כאן:
          </p>
          <Field label="קוד מהמייל">
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                className="text-center text-2xl tracking-[0.5em]"
                maxLength={10}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Button type="submit" className="w-full" disabled={busy || code.length < 6}>
            כניסה
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setStep('email')}>
            החלפת אימייל
          </Button>
        </form>
      )}

      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="h-px flex-1 bg-line" />
        או
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button variant="secondary" onClick={signInWithGoogle}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
        </svg>
        כניסה עם Google
      </Button>
      {error != null && <ErrorBox error={error} />}
    </div>
  )
}
