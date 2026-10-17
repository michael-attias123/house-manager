import { HandCoins } from 'lucide-react'
import { formatILS } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Feedback'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { useBalances } from '../hooks'
import { simplifyDebts, type Transfer } from '../lib/balances'

export function BalanceCard({ onSettle }: { onSettle?: (t: Transfer) => void }) {
  const { memberById, user } = useHousehold()
  const balances = useBalances()
  const transfers = simplifyDebts(balances.data ?? {})

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <HandCoins size={18} className="text-brand-700" />
        <h2 className="font-semibold">מאזן</h2>
      </div>
      {balances.isPending ? (
        <Spinner />
      ) : transfers.length === 0 ? (
        <p className="text-ink-2">אתם מאוזנים 👌</p>
      ) : (
        <ul className="space-y-3">
          {transfers.map((t) => {
            const from = memberById(t.from)
            const to = memberById(t.to)
            const toMe = t.to === user.id
            return (
              <li key={`${t.from}-${t.to}`} className="flex items-center gap-3">
                <MemberAvatar member={to} />
                <p className="flex-1 leading-tight">
                  {toMe ? 'יתרה לטובתך' : `יתרה לטובת ${to?.display_name}`}
                  <span className={`num block text-2xl font-bold ${toMe ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {formatILS(t.amount)}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {t.from === user.id ? 'ההעברה ממך' : `ההעברה מ־${from?.display_name}`}
                  </span>
                </p>
                {onSettle && (
                  <Button variant="secondary" size="sm" onClick={() => onSettle(t)}>
                    סגירה
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
