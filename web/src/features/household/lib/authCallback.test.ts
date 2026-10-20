import { diagnoseSignIn, isEmbeddedBrowser, readAuthCallback, withoutAuthParams } from './authCallback'

const APP = 'https://house-manager-9y8.pages.dev'
const env = { storageWritable: true, standalone: false }

describe('readAuthCallback', () => {
  it('ignores ordinary URLs', () => {
    expect(readAuthCallback(`${APP}/`)).toBeNull()
    expect(readAuthCallback(`${APP}/shopping?tab=list#top`)).toBeNull()
  })

  it('recognises the PKCE code', () => {
    expect(readAuthCallback(`${APP}/?code=8f0c`)).toEqual({ kind: 'code' })
  })

  it('reads Supabase error redirects from the query or the fragment', () => {
    const query = `${APP}/?error=access_denied&error_code=access_denied&error_description=The+user+denied`
    expect(readAuthCallback(query)).toEqual({ kind: 'error', code: 'access_denied', description: 'The user denied' })
    const fragment = `${APP}/#error=server_error&error_description=Unable+to+exchange&sb=`
    expect(readAuthCallback(fragment)).toEqual({ kind: 'error', code: 'server_error', description: 'Unable to exchange' })
  })

  it('recognises implicit-flow tokens', () => {
    expect(readAuthCallback(`${APP}/#access_token=x&refresh_token=y&token_type=bearer`)).toEqual({ kind: 'tokens' })
  })
})

describe('withoutAuthParams', () => {
  it('drops the sign-in parameters and the fragment, keeping the rest', () => {
    expect(withoutAuthParams(`${APP}/?code=1&x=2#access_token=t`)).toBe('/?x=2')
    expect(withoutAuthParams(`${APP}/?error=a&error_code=a&error_description=d#error=a&sb=`)).toBe('/')
  })
})

describe('diagnoseSignIn', () => {
  it('explains a code that arrived without its verifier', () => {
    const failure = diagnoseSignIn({ kind: 'code' }, null, { storageWritable: true, standalone: false })
    expect(failure.message).toContain('לחלון אחר')
    expect(failure.detail).toBe('no code verifier · browser')
  })

  it('blames blocked storage when nothing can be saved', () => {
    const failure = diagnoseSignIn({ kind: 'code' }, null, { storageWritable: false, standalone: true })
    expect(failure.message).toContain('חסימת כל העוגיות')
    expect(failure.detail).toBe('storage blocked · home-screen app')
  })

  it('names the server errors of the code exchange', () => {
    expect(diagnoseSignIn({ kind: 'code' }, { code: 'flow_state_expired', message: 'x' }, env).message).toContain('5 דקות')
    expect(diagnoseSignIn({ kind: 'code' }, { code: 'flow_state_not_found', message: 'x' }, env).message).toContain('נוצל')
    expect(diagnoseSignIn({ kind: 'code' }, { name: 'AuthRetryableFetchError', message: 'Load failed' }, env).detail).toBe(
      'Load failed · browser',
    )
    expect(diagnoseSignIn({ kind: 'code' }, { name: 'AuthApiError', code: 'bad_code_verifier', message: 'm' }, env).detail).toBe(
      'bad_code_verifier: m · browser',
    )
  })

  it('passes on errors that Google or Supabase sent back', () => {
    expect(diagnoseSignIn({ kind: 'error', code: 'access_denied', description: '' }, null, env).message).toContain('בוטלה')
    const other = diagnoseSignIn({ kind: 'error', code: 'server_error', description: 'Unable to exchange' }, null, env)
    expect(other.detail).toBe('server_error: Unable to exchange · browser')
  })

  it('explains an address that is not on the allowed list', () => {
    const href = `${APP}/?error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user`
    const failure = diagnoseSignIn(readAuthCallback(href)!, null, env)
    expect(failure.message).toContain('לא מורשית')
    expect(failure.detail).toBe('not on allowed_emails · browser')
  })

  it('explains tokens from an older build', () => {
    expect(diagnoseSignIn({ kind: 'tokens' }, { message: 'Not a valid PKCE flow url.' }, env).message).toContain('גרסה קודמת')
  })
})

describe('isEmbeddedBrowser', () => {
  it('spots in-app browsers that Google blocks', () => {
    expect(
      isEmbeddedBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Instagram 380.0.0.30.80',
      ),
    ).toBe(true)
    expect(
      isEmbeddedBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 [FBAN/FBIOS;FBAV/500.0.0.40.104]',
      ),
    ).toBe(true)
  })

  it('leaves Safari, the home-screen app and desktop browsers alone', () => {
    const safari =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
    const homeScreen = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    for (const ua of [safari, homeScreen, chrome]) expect(isEmbeddedBrowser(ua)).toBe(false)
  })
})
