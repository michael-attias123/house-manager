import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { ErrorBox, Loading } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { useAddAllowedEmail, useAllowedEmails, useRemoveAllowedEmail } from '../hooks'
import { isValidEmail, normalizeEmail } from '../lib/admin'
import { Hint, Tag } from './Tag'

export function AllowedEmails() {
  const { user } = useHousehold()
  const emails = useAllowedEmails()
  const add = useAddAllowedEmail()
  const remove = useRemoveAllowedEmail()
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [invalid, setInvalid] = useState(false)
  const mine = normalizeEmail(user.email ?? '')

  if (emails.isPending) return <Loading />
  if (emails.error) return <ErrorBox error={emails.error} />
  const list = emails.data

  function submit() {
    if (!isValidEmail(email)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    add.mutate(
      { email, note },
      {
        onSuccess: () => {
          setEmail('')
          setNote('')
        },
      },
    )
  }

  return (
    <div className="space-y-3">
      {list.length === 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>
            הרשימה ריקה, ולכן כל חשבון Google יכול להירשם. הוספת כתובת ראשונה סוגרת את ההרשמה לכל השאר, והכתובת
            שלך נוספת אוטומטית.
          </p>
        </div>
      )}

      <Card>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="כתובת Gmail">
            {(id) => (
              <Input
                id={id}
                type="email"
                dir="ltr"
                inputMode="email"
                autoComplete="off"
                placeholder="you@gmail.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setInvalid(false)
                }}
              />
            )}
          </Field>
          <Field label="הערה (לא חובה)">
            {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Button type="submit" className="w-full" disabled={!email.trim() || add.isPending}>
            הוספה
          </Button>
          {invalid && <ErrorBox error="הכתובת לא נראית תקינה." />}
          {add.error && <ErrorBox error={add.error} />}
        </form>
      </Card>

      {list.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {list.map((row) => {
            const own = row.email === mine
            return (
              <li key={row.email} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="num truncate">{row.email}</span>
                    {own && <Tag tone="brand">הכתובת שלך</Tag>}
                  </p>
                  {row.note && <p className="truncate text-xs text-ink-3">{row.note}</p>}
                </div>
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  confirmLabel="להסיר?"
                  disabled={own || remove.isPending}
                  title={own ? 'הכתובת שלך' : undefined}
                  onConfirm={() => remove.mutate(row.email)}
                >
                  הסרה
                </ConfirmButton>
              </li>
            )
          })}
        </ul>
      )}
      {remove.error && <ErrorBox error={remove.error} />}

      <Hint>הסרה חוסמת רק הרשמה חדשה. חשבון קיים ממשיך לעבוד עד שמוחקים אותו בלשונית משתמשים.</Hint>
    </div>
  )
}
