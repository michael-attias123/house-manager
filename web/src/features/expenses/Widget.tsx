import { Link } from 'react-router-dom'
import { BalanceCard } from './components/BalanceCard'

export function ExpensesWidget() {
  return (
    <Link to="/expenses" className="block">
      <BalanceCard />
    </Link>
  )
}
