import { goingOutErrorMessage } from './errors'

describe('goingOutErrorMessage', () => {
  it('says the server errors in Hebrew and passes others through', () => {
    expect(goingOutErrorMessage('not found')).toBe('הדיל לא נמצא, אולי כבר נמחק.')
    expect(goingOutErrorMessage('new row violates row-level security policy for table "venue_deals"')).toBe(
      'אין הרשאה לשמור את זה.',
    )
    expect(goingOutErrorMessage('something else')).toBe('something else')
  })
})
