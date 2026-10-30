import { goingOutErrorMessage } from './errors'

describe('goingOutErrorMessage', () => {
  it('says the server errors in Hebrew and passes others through', () => {
    expect(goingOutErrorMessage('not found')).toBe('לא נמצא, אולי כבר נמחק.')
    expect(goingOutErrorMessage('admin only')).toBe('רק מנהלי האפליקציה יכולים לעשות את זה.')
    expect(goingOutErrorMessage('only an admin review changes venue_deals.status')).toBe('את הסטטוס משנים רק במסך הניהול.')
    expect(goingOutErrorMessage('new row violates row-level security policy for table "venue_deals"')).toBe(
      'אין הרשאה לשמור את זה.',
    )
    expect(goingOutErrorMessage('something else')).toBe('something else')
  })
})
