import { readAuthRedirectError } from './authRedirect'

describe('readAuthRedirectError', () => {
  it('ignores a normal URL', () => {
    expect(readAuthRedirectError('https://app.example/')).toBeNull()
    expect(readAuthRedirectError('https://app.example/?code=abc')).toBeNull()
    expect(readAuthRedirectError('https://app.example/#/shopping')).toBeNull()
  })

  it('recognizes a refused sign-up and cleans query and hash', () => {
    const error =
      'error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user'
    expect(readAuthRedirectError(`https://app.example/?${error}#${error}&sb=`)).toEqual({
      description: 'Database error saving new user',
      notAllowed: true,
      cleanUrl: 'https://app.example/',
    })
  })

  it('keeps unrelated params', () => {
    const result = readAuthRedirectError(
      'https://app.example/?x=1&error=access_denied#error=access_denied&sb=&y=2',
    )
    expect(result).toEqual({
      description: 'access_denied',
      notAllowed: false,
      cleanUrl: 'https://app.example/?x=1#y=2',
    })
  })

  it('reads an error in the hash only', () => {
    const result = readAuthRedirectError(
      'https://app.example/#error_description=email+not+allowed%3A+a%40b.c',
    )
    expect(result?.notAllowed).toBe(true)
    expect(result?.cleanUrl).toBe('https://app.example/')
  })
})
