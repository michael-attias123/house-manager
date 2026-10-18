import { RotateCcw } from 'lucide-react'
import { DEMO_USERS } from './seed'
import { currentUserId, resetDemo, switchUser } from './store'

/** Demo-only strip: whose phone you are looking at, and a reset. */
export default function DemoBanner() {
  const me = currentUserId()
  return (
    <div className="bg-amber-100 text-amber-950 dark:bg-amber-900/60 dark:text-amber-50">
      <div className="mx-auto flex max-w-lg items-center gap-2 px-4 py-1.5 text-xs">
        <span className="font-semibold">דמו</span>
        <span className="flex-1">הנתונים לדוגמה ונשמרים רק בדפדפן הזה.</span>
        <span>הטלפון של:</span>
        {DEMO_USERS.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => u.id !== me && switchUser(u.id)}
            aria-pressed={u.id === me}
            className={`rounded-full px-2 py-0.5 ${u.id === me ? 'bg-amber-950 text-amber-50 dark:bg-amber-50 dark:text-amber-950' : 'underline'}`}
          >
            {u.name}
          </button>
        ))}
        <button type="button" onClick={resetDemo} aria-label="איפוס הדמו" title="איפוס הדמו" className="p-1">
          <RotateCcw size={14} />
        </button>
      </div>
    </div>
  )
}
