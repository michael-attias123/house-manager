import type { APIEvent, Meta, TransportItem, TransportItemType } from '@grafana/faro-web-sdk'
import { sanitizeItem, sanitizeMeta } from './sanitize'

const SUPABASE = 'https://abc.supabase.co'
const UUID = '3f2b8c1e-9d4a-4b7e-8f00-1a2b3c4d5e6f'
const options = { supabaseUrl: SUPABASE, online: true }

const meta: Meta = {
  app: { name: 'house-manager', version: 'abc1234', environment: 'production', release: 'x' },
  session: {
    id: 'Ab3dE6gH9k',
    attributes: { isSampled: 'true', previousSession: 'Zz9', household: UUID },
  },
  page: {
    url: `https://house.pages.dev/expenses?code=8f0c#access_token=t`,
    id: 'p1',
    attributes: { title: 'הוצאות' },
  },
  view: { name: '/expenses' },
  user: { email: 'dana@example.com', id: UUID, username: 'dana' },
  browser: { name: 'Safari', version: '18.5', os: 'iOS 18.5', mobile: true, language: 'he-IL' },
  sdk: { name: 'faro-web-sdk', version: '2.13.0' },
}

function item(type: string, payload: unknown): TransportItem<APIEvent> {
  return { type: type as TransportItemType, payload: payload as APIEvent, meta }
}

/** Every string anywhere in a value, for "nothing like this leaks" checks. */
function json(value: unknown): string {
  return JSON.stringify(value)
}

function expectClean(value: unknown) {
  const text = json(value)
  expect(text).not.toMatch(/[֐-׿]/)
  expect(text).not.toContain('@example.com')
  expect(text).not.toContain(UUID)
  expect(text).not.toContain('?')
  expect(text).not.toContain('access_token')
}

describe('sanitizeMeta', () => {
  it('keeps app, session id and sampling flag, browser and the page path; drops the user', () => {
    const out = sanitizeMeta(meta)
    expect(out.user).toBeUndefined()
    expect(out.page).toEqual({ url: 'https://house.pages.dev/expenses' })
    expect(out.session).toEqual({
      id: 'Ab3dE6gH9k',
      attributes: { isSampled: 'true', previousSession: 'Zz9' },
    })
    expect(out.app).toEqual({
      name: 'house-manager',
      version: 'abc1234',
      environment: 'production',
    })
    expect(out.browser?.os).toBe('iOS 18.5')
    expectClean(out)
  })
})

describe('sanitizeItem', () => {
  it('redacts exceptions and keeps only the allowed context', () => {
    const out = sanitizeItem(
      item('exception', {
        type: 'Error',
        value: `Key (household_id, name)=(${UUID}, חלב) already exists for dana@example.com`,
        timestamp: 't',
        stacktrace: {
          frames: [
            {
              filename: 'https://house.pages.dev/assets/index-Bkq4Ja0V.js?v=1',
              function: 'save',
              lineno: 3,
              colno: 4,
            },
          ],
        },
        context: { source: 'error_boundary', cause: '{"note":"דמי ועד"}' },
      }),
      options,
    )
    expect(out?.payload).toEqual({
      type: 'Error',
      value: 'Key [str]=[str] already exists for [email]',
      timestamp: 't',
      stacktrace: {
        frames: [
          {
            filename: 'https://house.pages.dev/assets/index-Bkq4Ja0V.js',
            function: 'save',
            lineno: 3,
            colno: 4,
          },
        ],
      },
      context: { source: 'error_boundary' },
    })
    expectClean(out)
  })

  it('drops fetch failures while offline, and keeps them online', () => {
    const failed = item('exception', {
      type: 'TypeError',
      value: 'Failed to fetch',
      timestamp: 't',
    })
    expect(sanitizeItem(failed, { ...options, online: false })).toBeNull()
    expect(sanitizeItem(failed, options)).not.toBeNull()
  })

  it('keeps the app events with their allowed attributes only', () => {
    const out = sanitizeItem(
      item('event', {
        name: 'realtime_status',
        timestamp: 't',
        attributes: { status: 'TIMED_OUT', table: 'expenses', topic: `x:${UUID}` },
      }),
      options,
    )
    expect(out?.payload).toMatchObject({
      name: 'realtime_status',
      attributes: { status: 'TIMED_OUT', table: 'expenses' },
    })
    expect(json(out)).not.toContain('topic')
  })

  it('drops unknown events (user actions, navigation, resource timings, CSP reports)', () => {
    for (const name of [
      'faro.user.action',
      'faro.navigation',
      'faro.performance.resource',
      'securitypolicyviolation',
      'toString',
    ]) {
      expect(
        sanitizeItem(item('event', { name, timestamp: 't', attributes: { a: 'b' } }), options),
      ).toBeNull()
    }
  })

  it('keeps page views as paths', () => {
    const out = sanitizeItem(
      item('event', {
        name: 'view_changed',
        timestamp: 't',
        attributes: { fromView: 'default', toView: `/x/${UUID}` },
      }),
      options,
    )
    expect(out?.payload).toMatchObject({ attributes: { fromView: 'default', toView: '/x/[id]' } })
  })

  it('reduces fetch events to the Supabase target, method, status and duration', () => {
    const out = sanitizeItem(
      item('event', {
        name: 'faro.tracing.fetch',
        timestamp: 't',
        attributes: {
          'http.url': `${SUPABASE}/rest/v1/shopping_items?household_id=eq.${UUID}&name=eq.חלב`,
          'http.method': 'GET',
          'http.status_code': '200',
          'http.user_agent': 'Mozilla',
          duration_ns: '120000000',
          'faro.action.user.name': 'הוספה',
        },
      }),
      options,
    )
    expect(out?.payload).toMatchObject({
      attributes: {
        target: 'rest:shopping_items',
        method: 'GET',
        status: '200',
        duration_ns: '120000000',
      },
    })
    expectClean(out)
    const other = item('event', {
      name: 'faro.tracing.fetch',
      timestamp: 't',
      attributes: { 'http.url': 'https://x.dev/a' },
    })
    expect(sanitizeItem(other, options)).toBeNull()
  })

  it('keeps web vitals values without attribution', () => {
    const out = sanitizeItem(
      item('measurement', {
        type: 'web-vitals',
        values: { lcp: 1200, delta: 1200 },
        timestamp: 't',
        context: {
          id: 'v1',
          rating: 'good',
          element: 'div.item-name',
          resource_url: 'https://x.dev/a?b',
        },
      }),
      options,
    )
    expect(out?.payload).toEqual({
      type: 'web-vitals',
      values: { lcp: 1200, delta: 1200 },
      timestamp: 't',
      context: { id: 'v1', rating: 'good' },
    })
    expect(
      sanitizeItem(
        item('measurement', { type: 'custom', values: { amount: 120 }, timestamp: 't' }),
        options,
      ),
    ).toBeNull()
  })

  it('drops logs', () => {
    expect(
      sanitizeItem(item('log', { message: 'דנה', level: 'info', timestamp: 't' }), options),
    ).toBeNull()
  })

  it('renames Supabase spans to their target and drops every other span and attribute', () => {
    const span = (url: string) => ({
      traceId: 't',
      spanId: 's',
      name: 'HTTP GET',
      kind: 3,
      attributes: [
        { key: 'http.url', value: { stringValue: url } },
        { key: 'http.method', value: { stringValue: 'POST' } },
        { key: 'http.status_code', value: { intValue: 409 } },
        { key: 'http.user_agent', value: { stringValue: 'Mozilla' } },
        { key: 'session.id', value: { stringValue: 'Ab3dE6gH9k' } },
        { key: 'user.email', value: { stringValue: 'dana@example.com' } },
      ],
      events: [
        { name: 'exception', attributes: [{ key: 'message', value: { stringValue: 'חלב' } }] },
      ],
      links: [
        { traceId: 'l', spanId: 'm', attributes: [{ key: 'x', value: { stringValue: UUID } }] },
      ],
      status: { code: 2, message: `duplicate (${UUID})` },
    })
    const out = sanitizeItem(
      item('trace', {
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'house-manager' } },
                { key: 'user.id', value: { stringValue: UUID } },
              ],
            },
            scopeSpans: [
              {
                scope: { name: '@opentelemetry/instrumentation-fetch' },
                spans: [
                  span(`${SUPABASE}/rest/v1/rpc/save_expense?x=${UUID}`),
                  span('https://elsewhere.dev/a'),
                ],
              },
            ],
          },
        ],
      }),
      options,
    )
    const rs = (
      out?.payload as {
        resourceSpans: {
          resource: { attributes: { key: string }[] }
          scopeSpans: { spans: unknown[] }[]
        }[]
      }
    ).resourceSpans
    expect(rs[0].resource.attributes.map((a) => a.key)).toEqual(['service.name'])
    expect(rs[0].scopeSpans[0].spans).toHaveLength(1)
    expect(rs[0].scopeSpans[0].spans[0]).toMatchObject({
      name: 'POST rpc:save_expense',
      attributes: [
        { key: 'http.url', value: { stringValue: `${SUPABASE}/rest/v1/rpc/save_expense` } },
        { key: 'http.method', value: { stringValue: 'POST' } },
        { key: 'http.status_code', value: { intValue: 409 } },
        { key: 'session.id', value: { stringValue: 'Ab3dE6gH9k' } },
        { key: 'supabase.target', value: { stringValue: 'rpc:save_expense' } },
      ],
      events: [],
      links: [{ traceId: 'l', spanId: 'm', attributes: [] }],
      status: { code: 2, message: 'duplicate [str]' },
    })
    expectClean(out)
  })

  it('drops a trace with no Supabase span left', () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  name: 'x',
                  attributes: [{ key: 'http.url', value: { stringValue: 'https://x.dev/' } }],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(sanitizeItem(item('trace', payload), options)).toBeNull()
  })
})
