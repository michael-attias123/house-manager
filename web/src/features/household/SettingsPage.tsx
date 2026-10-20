import { Suspense, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, LogOut, RefreshCw, Share2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { FEATURES } from '@/app/features'
import { addPlaceholderMember, regenerateInviteCode, renameHousehold, updateMember } from './api'
import { householdKeys, useHousehold } from './HouseholdProvider'

const COLORS = ['#0ea5e9', '#f43f5e', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#6366f1', '#14b8a6']

export function SettingsPage() {
  const { household, members, me, partner, user } = useHousehold()
  const queryClient = useQueryClient()
  const [householdName, setHouseholdName] = useState(household.name)
  const [myName, setMyName] = useState(me?.display_name ?? '')
  const [myShare, setMyShare] = useState(me?.default_share_pct ?? 50)
  const [copied, setCopied] = useState(false)
  const [partnerName, setPartnerName] = useState('')

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: householdKeys.members(household.id) }),
      queryClient.invalidateQueries({ queryKey: householdKeys.mine(user.id) }),
    ])

  const save = useMutation({
    mutationFn: async () => {
      if (householdName.trim() && householdName !== household.name) {
        await renameHousehold(household.id, householdName.trim())
      }
      if (me && myName.trim() && myName !== me.display_name) {
        await updateMember(household.id, me.user_id, { display_name: myName.trim() })
      }
      if (me && partner && myShare !== me.default_share_pct) {
        await updateMember(household.id, me.user_id, { default_share_pct: myShare })
        await updateMember(household.id, partner.user_id, { default_share_pct: 100 - myShare })
      }
    },
    onSuccess: refresh,
  })

  const setColor = useMutation({
    mutationFn: (color: string) => updateMember(household.id, user.id, { color }),
    onSuccess: refresh,
  })

  const addPartner = useMutation({
    mutationFn: () => addPlaceholderMember(household.id, partnerName.trim()),
    onSuccess: async () => {
      setPartnerName('')
      await refresh()
    },
  })

  const regenerate = useMutation({
    mutationFn: () => regenerateInviteCode(household.id),
    onSuccess: refresh,
  })

  const inviteText = `הצטרפות לבית "${household.name}" באפליקציה: ${window.location.origin}\nקוד הזמנה: ${household.invite_code}`

  async function share() {
    if (navigator.share) {
      await navigator.share({ text: inviteText }).catch(() => undefined)
    } else {
      await navigator.clipboard.writeText(inviteText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <CardTitle>חברי הבית</CardTitle>
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3">
              <MemberAvatar member={m} />
              <span className="flex-1">
                {m.display_name}
                {m.is_placeholder && <span className="ms-2 text-xs text-ink-3">בלי חשבון עדיין</span>}
              </span>
              <span className="num text-sm text-ink-2">{m.default_share_pct}%</span>
            </li>
          ))}
        </ul>
        {members.length < 2 && (
          <div className="space-y-2 rounded-xl bg-brand-50 p-3 dark:bg-brand-800/20">
            <p className="text-sm">
              שלחו את קוד ההזמנה לבן/בת הזוג. אחרי הכניסה לאפליקציה בוחרים "הצטרפות עם קוד".
            </p>
            <p className="text-sm text-ink-2">
              אפשר גם להוסיף את השם כבר עכשיו ולרשום עליו הוצאות. בהצטרפות עם הקוד, הכל עובר לחשבון.
            </p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (partnerName.trim()) addPartner.mutate()
              }}
            >
              <Input
                aria-label="שם בן/בת הזוג"
                placeholder="שם"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={!partnerName.trim() || addPartner.isPending}>
                הוספה
              </Button>
            </form>
            {addPartner.error && <ErrorBox error={addPartner.error} />}
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="num flex-1 rounded-xl bg-surface-2 py-2 text-center text-xl font-semibold tracking-[0.3em]">
            {household.invite_code}
          </span>
          <Button variant="secondary" size="icon" onClick={share} aria-label="שיתוף קוד הזמנה">
            {copied ? <Copy size={18} /> : <Share2 size={18} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => regenerate.mutate()}
            aria-label="קוד חדש"
            disabled={regenerate.isPending}
          >
            <RefreshCw size={18} />
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <CardTitle>פרטים</CardTitle>
        <Field label="שם הבית">
          {(id) => <Input id={id} value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />}
        </Field>
        <Field label="השם שלי">
          {(id) => <Input id={id} value={myName} onChange={(e) => setMyName(e.target.value)} />}
        </Field>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">הצבע שלי</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor.mutate(c)}
                className="h-8 w-8 rounded-full ring-offset-2 ring-offset-surface"
                style={{
                  backgroundColor: c,
                  boxShadow: me?.color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined,
                }}
              />
            ))}
          </div>
        </div>
        {partner && (
          <Field
            label="חלוקת הוצאות ברירת מחדל"
            hint="משמש לחלוקת קניות וחשבונות. בכל הוצאה אפשר לבחור אחרת."
          >
            {(id) => (
              <div className="space-y-1">
                <input
                  id={id}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={myShare}
                  onChange={(e) => setMyShare(Number(e.target.value))}
                  className="w-full accent-brand-700"
                />
                <div className="flex justify-between text-sm">
                  <span>
                    {me?.display_name} <span className="num">{myShare}%</span>
                  </span>
                  <span>
                    {partner.display_name} <span className="num">{100 - myShare}%</span>
                  </span>
                </div>
              </div>
            )}
          </Field>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
          {save.isSuccess ? 'נשמר ✓' : 'שמירה'}
        </Button>
        {save.error && <ErrorBox error={save.error} />}
      </Card>

      {FEATURES.filter((f) => f.SettingsSection).map(({ id, SettingsSection }) => (
        <ErrorBoundary key={id}>
          <Suspense fallback={null}>{SettingsSection && <SettingsSection />}</Suspense>
        </ErrorBoundary>
      ))}

      <Button variant="ghost" className="w-full" onClick={() => supabase.auth.signOut()}>
        <LogOut size={18} />
        יציאה מהחשבון
      </Button>
    </div>
  )
}
