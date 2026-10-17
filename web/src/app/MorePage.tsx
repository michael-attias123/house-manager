import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { moreFeatures } from './features'

export function MorePage() {
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {moreFeatures().map((f) => (
        <li key={f.id}>
          <Link to={f.path} className="flex items-center gap-3 px-4 py-3.5">
            <f.icon size={20} className="text-brand-700" />
            <span className="flex-1">{f.title}</span>
            <ChevronLeft size={18} className="text-ink-3" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
