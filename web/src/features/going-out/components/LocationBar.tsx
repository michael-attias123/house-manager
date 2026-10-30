import { MapPin, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Feedback'
import type { LocationValue } from '../hooks'

const FROM_CENTER = 'המרחקים ממרכז העיר'

/** Where the distances are measured from; asks for the location only on a tap. */
export function LocationBar({ location }: { location: LocationValue }) {
  const { state, request } = location
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2" role="status">
      {state === 'idle' && (
        <>
          <Button variant="secondary" size="sm" onClick={request}>
            📍 לפי המיקום שלי
          </Button>
          <span>· {FROM_CENTER}</span>
        </>
      )}
      {state === 'asking' && (
        <>
          <Spinner className="h-4 w-4" />
          <span>מאתרים את המיקום…</span>
        </>
      )}
      {state === 'granted' && (
        <>
          <span>📍 לפי המיקום שלך</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={request} aria-label="רענון המיקום">
            <RotateCw size={16} />
          </Button>
        </>
      )}
      {state === 'denied' && (
        <span className="flex items-center gap-1">
          <MapPin size={16} className="shrink-0 text-ink-3" />
          אין הרשאת מיקום. {FROM_CENTER}
        </span>
      )}
      {state === 'outside' && (
        <>
          <span className="flex items-center gap-1">
            <MapPin size={16} className="shrink-0 text-ink-3" />
            המיקום מחוץ לבאר שבע. {FROM_CENTER}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={request} aria-label="רענון המיקום">
            <RotateCw size={16} />
          </Button>
        </>
      )}
      {state === 'error' && (
        <>
          <span>המיקום לא זמין כרגע. {FROM_CENTER}</span>
          <Button variant="ghost" size="sm" onClick={request}>
            לנסות שוב
          </Button>
        </>
      )}
    </div>
  )
}
