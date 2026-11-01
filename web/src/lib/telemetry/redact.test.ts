import { MAX_LENGTH, redact, redactUrl, stripUrl } from './redact'

describe('redact', () => {
  it('replaces email addresses', () => {
    expect(redact('no account for dana.cohen+home@example.co.il yet')).toBe(
      'no account for [email] yet',
    )
  })

  it('replaces UUIDs', () => {
    expect(redact('household 3f2b8c1e-9d4a-4b7e-8f00-1a2b3c4d5e6f not found')).toBe(
      'household [id] not found',
    )
  })

  it('replaces runs of Hebrew, keeping the code around them', () => {
    expect(redact('Cannot save חלב תנובה 3% now')).toBe('Cannot save [he] 3% now')
    expect(redact('שגיאה')).toBe('[he]')
  })

  it('replaces quoted and parenthesised text (Postgres messages and details)', () => {
    expect(redact('duplicate key value violates unique constraint "shopping_items_name_key"')).toBe(
      'duplicate key value violates unique constraint [str]',
    )
    expect(redact('Key (household_id, name)=(abc, חלב) already exists.')).toBe(
      'Key [str]=[str] already exists.',
    )
    expect(redact("invalid input syntax for type uuid: 'x'")).toBe(
      'invalid input syntax for type uuid: [str]',
    )
    expect(redact('השם “דנה” כבר קיים')).toBe('[he] [str] [he]')
  })

  it('replaces numbers of two or more digits, keeping single digits and code identifiers', () => {
    expect(redact('amount 120.50 split 2 ways')).toBe('amount [n].[n] split 2 ways')
    expect(redact('call 050-1234567')).toBe('call [n]-[n]')
    expect(redact('index-Bkq4Ja0V.js:12')).toBe('index-Bkq4Ja0V.js:[n]')
  })

  it('cuts URLs to origin and path, then redacts the path', () => {
    expect(
      redact(
        'GET https://abc.supabase.co/rest/v1/shopping_items?select=*&household_id=eq.3f2b8c1e-9d4a-4b7e-8f00-1a2b3c4d5e6f failed',
      ),
    ).toBe('GET https://abc.supabase.co/rest/v1/shopping_items failed')
    expect(redact('at https://app.example/expenses/3f2b8c1e-9d4a-4b7e-8f00-1a2b3c4d5e6f#x')).toBe(
      'at https://app.example/expenses/[id]',
    )
    expect(
      redact('wss://abc.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0'),
    ).toBe('wss://abc.supabase.co/realtime/v1/websocket')
    // The OAuth return: the one-time code never leaves.
    expect(redact('https://house.pages.dev/?code=8f0c1d2e')).toBe('https://house.pages.dev/')
  })

  it('keeps ordinary error text readable', () => {
    expect(redact('TypeError: Cannot read properties of undefined')).toBe(
      'TypeError: Cannot read properties of undefined',
    )
    expect(redact('ChunkLoadError: Failed to fetch dynamically imported module')).toBe(
      'ChunkLoadError: Failed to fetch dynamically imported module',
    )
  })

  it(`cuts the result to ${MAX_LENGTH} characters`, () => {
    const out = redact('x'.repeat(500))
    expect(out).toHaveLength(MAX_LENGTH)
    expect(out.endsWith('…')).toBe(true)
  })

  it('accepts anything', () => {
    expect(redact(undefined)).toBe('')
    expect(redact(null)).toBe('')
    expect(redact(42)).toBe('[n]')
  })

  it('is stable when applied twice', () => {
    const once = redact(
      'Key (name)=(חלב) for a@b.co at https://x.dev/a?b=1 id 3f2b8c1e-9d4a-4b7e-8f00-1a2b3c4d5e6f',
    )
    expect(redact(once)).toBe(once)
  })
})

describe('stripUrl and redactUrl', () => {
  it('keeps origin and path only', () => {
    expect(stripUrl('https://house.pages.dev/shopping?tab=list#top')).toBe(
      'https://house.pages.dev/shopping',
    )
    expect(stripUrl('http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  it('decodes the path so encoded Hebrew is caught', () => {
    expect(redactUrl('https://house.pages.dev/x/%D7%97%D7%9C%D7%91')).toBe(
      'https://house.pages.dev/x/[he]',
    )
  })

  it('never passes through what it cannot parse', () => {
    expect(stripUrl('not a url')).toBe('[url]')
    expect(stripUrl('blob:https://house.pages.dev/3f2b8c1e')).toBe('blob:[url]')
  })
})
