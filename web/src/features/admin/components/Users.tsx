import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { useAdminUsers, useAllowedEmails, useDeleteUser } from '../hooks'
import { formatDate, formatDateTime } from '../lib/admin'
import { Hint, Tag } from './Tag'

export function Users() {
  const { user } = useHousehold()
  const users = useAdminUsers()
  const emails = useAllowedEmails()
  const remove = useDeleteUser()

  if (users.isPending) return <Loading />
  if (users.error) return <ErrorBox error={users.error} />
  // An empty list lets everyone in, so "not on the list" only matters once it has addresses.
  const listActive = (emails.data?.length ?? 0) > 0

  return (
    <div className="space-y-3">
      {users.data.length === 0 ? (
        <EmptyState icon="👤" title="עוד אין משתמשים" />
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {users.data.map((u) => {
            const self = u.id === user.id
            return (
              <li key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{u.full_name || u.email || '—'}</span>
                    {u.is_admin && <Tag tone="brand">הרשאת ניהול</Tag>}
                    {self && <Tag tone="brand">החשבון שלך</Tag>}
                    {listActive && !u.on_allowlist && <Tag tone="warn">לא ברשימת ההרשמה</Tag>}
                  </p>
                  {u.full_name && u.email && (
                    <p className="truncate text-xs text-ink-3">
                      <span className="num">{u.email}</span>
                    </p>
                  )}
                  <p className="text-xs text-ink-3">
                    הצטרפות: <span className="num">{formatDate(u.created_at)}</span>
                  </p>
                  <p className="text-xs text-ink-3">
                    כניסה אחרונה: <span className="num">{formatDateTime(u.last_sign_in_at)}</span>
                  </p>
                  {u.household_names.length > 0 && (
                    <p className="truncate text-xs text-ink-2">{u.household_names.join(' · ')}</p>
                  )}
                </div>
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  confirmLabel="למחוק את החשבון?"
                  disabled={self || u.is_admin || remove.isPending}
                  title={self ? 'החשבון שלך' : u.is_admin ? 'הרשאת ניהול' : undefined}
                  onConfirm={() => remove.mutate(u.id)}
                >
                  מחיקת החשבון
                </ConfirmButton>
              </li>
            )
          })}
        </ul>
      )}
      {remove.error && <ErrorBox error={remove.error} />}
      <Hint>מחיקה מוציאה את החשבון מכל הבתים. הוצאות ויתרות שנרשמו עליו נשארות על שם בלי חשבון.</Hint>
    </div>
  )
}
