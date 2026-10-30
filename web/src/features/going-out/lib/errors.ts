// Server errors in Hebrew. Matched by substring, so PostgREST's messages and
// the demo's plain ones both work.
const ERRORS: [string, string][] = [
  ['not found', 'לא נמצא, אולי כבר נמחק.'],
  ['admin only', 'רק מנהלי האפליקציה יכולים לעשות את זה.'],
  ['row-level security', 'אין הרשאה לשמור את זה.'],
  ['change only through admin_review', 'את הסטטוס משנים רק במסך הניהול.'],
  ['only an admin review changes', 'את הסטטוס משנים רק במסך הניהול.'],
  ['violates check constraint', 'חלק מהפרטים לא תקינים.'],
]

export function goingOutErrorMessage(message: string): string {
  return ERRORS.find(([key]) => message.includes(key))?.[1] ?? message
}
