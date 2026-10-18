import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { createHousehold, joinHousehold } from './api'
import { householdKeys } from './HouseholdProvider'

export function OnboardingPage({ user }: { user: User }) {
  const queryClient = useQueryClient()
  const suggestedName =
    (user.user_metadata?.full_name as string | undefined)?.split(' ')[0] ??
    user.email?.split('@')[0] ??
    ''
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [displayName, setDisplayName] = useState(suggestedName)
  const [householdName, setHouseholdName] = useState('הבית שלנו')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') await createHousehold(householdName, displayName)
      else await joinHousehold(code, displayName)
      await queryClient.invalidateQueries({ queryKey: householdKeys.mine(user.id) })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">ברוכים הבאים 👋</h1>
        <p className="text-ink-2">
          אחד מכם יוצר את הבית, והשני מצטרף עם קוד ההזמנה שמופיע בהגדרות.
        </p>
      </div>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'create', label: 'בית חדש' },
          { value: 'join', label: 'הצטרפות עם קוד' },
        ]}
      />
      <form onSubmit={submit} className="space-y-4">
        <Field label="איך לקרוא לך?">
          {(id) => (
            <Input id={id} required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          )}
        </Field>
        {mode === 'create' ? (
          <Field label="שם הבית">
            {(id) => (
              <Input id={id} value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
            )}
          </Field>
        ) : (
          <Field label="קוד הזמנה">
            {(id) => (
              <Input
                id={id}
                required
                dir="ltr"
                className="text-center text-xl tracking-[0.4em] uppercase"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            )}
          </Field>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === 'create' ? 'יצירת הבית' : 'הצטרפות'}
        </Button>
      </form>
      {error != null && <ErrorBox error={error} />}
      <Button variant="ghost" onClick={() => supabase.auth.signOut()}>
        יציאה מהחשבון
      </Button>
    </div>
  )
}
