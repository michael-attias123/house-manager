import { Link } from 'react-router-dom'
import { ChevronLeft, ShieldCheck } from 'lucide-react'
import { Card, CardTitle } from '@/components/ui/Card'
import { useIsAdmin } from './hooks'

/** Settings section; shown only to admins (app_admins). */
export default function AdminSettingsCard() {
  const isAdmin = useIsAdmin()
  if (isAdmin.data !== true) return null
  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <CardTitle>ניהול האפליקציה</CardTitle>
        <p className="text-sm text-ink-2">רשימת ההרשמה, בתים, משתמשים, עדכוני מחירים והצעות ללאן יוצאים.</p>
      </div>
      <Link
        to="/admin"
        className="flex h-11 items-center gap-2 rounded-xl bg-surface-2 px-4 font-medium text-ink hover:bg-line"
      >
        <ShieldCheck size={18} className="text-brand-700" />
        <span className="flex-1">פתיחת מסך הניהול</span>
        <ChevronLeft size={18} className="text-ink-3" />
      </Link>
    </Card>
  )
}
