import { Card } from '@/components/ui/Card'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { useHousehold } from '@/features/household/HouseholdProvider'
import type { AdminHousehold } from '@/lib/db-types'
import { useAdminHouseholds, useDeleteHousehold, useRemoveMember } from '../hooks'
import { formatDate, hasActiveMember, memberStatus } from '../lib/admin'
import { Count, Hint, Tag } from './Tag'

export function Households() {
  const households = useAdminHouseholds()
  if (households.isPending) return <Loading />
  if (households.error) return <ErrorBox error={households.error} />
  return (
    <div className="space-y-3">
      {households.data.length === 0 ? (
        <EmptyState icon="🏠" title="עוד אין בתים" />
      ) : (
        households.data.map((h) => <HouseholdCard key={h.id} household={h} />)
      )}
      <Hint>מחיקת בית מוחקת את כל הרשימות, ההוצאות, החשבונות והמטלות שלו, בלי אפשרות לשחזר.</Hint>
    </div>
  )
}

function HouseholdCard({ household: h }: { household: AdminHousehold }) {
  const { user } = useHousehold()
  const removeMember = useRemoveMember()
  const deleteHousehold = useDeleteHousehold()
  // Same rule as the server: any household the admin belongs to is theirs.
  const own = h.members.some((m) => m.user_id === user.id)

  return (
    <Card className="space-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{h.name}</h3>
          {own && <Tag tone="brand">הבית שלך</Tag>}
          {!hasActiveMember(h.members) && <Tag tone="warn">אין חשבון פעיל</Tag>}
        </div>
        <p className="text-xs text-ink-3">
          נוצר: <span className="num">{formatDate(h.created_at)}</span>
        </p>
        <p className="text-sm text-ink-2">
          <Count n={h.expense_count} one="הוצאה" many="הוצאות" /> · <Count n={h.bill_count} one="חשבון" many="חשבונות" />{' '}
          · <Count n={h.chore_count} one="מטלה" many="מטלות" /> ·{' '}
          <Count n={h.list_item_count} one="פריט ברשימה" many="פריטים ברשימה" />
        </p>
      </div>

      {h.members.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {h.members.map((m) => {
            const status = memberStatus(m)
            const self = m.user_id === user.id
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="truncate">{m.display_name}</span>
                    {status === 'placeholder' && <Tag>בלי חשבון</Tag>}
                    {status === 'deleted' && <Tag tone="danger">חשבון נמחק</Tag>}
                    {self && <Tag tone="brand">החשבון שלך</Tag>}
                  </p>
                  {m.email && (
                    <p className="truncate text-xs text-ink-3">
                      <span className="num">{m.email}</span>
                    </p>
                  )}
                </div>
                {!self && (
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    confirmLabel="להסיר?"
                    disabled={removeMember.isPending}
                    onConfirm={() => removeMember.mutate({ householdId: h.id, userId: m.user_id })}
                  >
                    הסרה מהבית
                  </ConfirmButton>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {removeMember.error && <ErrorBox error={removeMember.error} />}

      <div className="flex justify-end">
        <ConfirmButton
          size="sm"
          variant="secondary"
          confirmLabel={`למחוק את „${h.name}” לצמיתות?`}
          disabled={own || deleteHousehold.isPending}
          title={own ? 'הבית שלך' : undefined}
          onConfirm={() => deleteHousehold.mutate(h.id)}
        >
          מחיקת הבית
        </ConfirmButton>
      </div>
      {deleteHousehold.error && <ErrorBox error={deleteHousehold.error} />}
    </Card>
  )
}
