// Faro's beforeSend hook: every item is rebuilt from an allow-list before it
// leaves the browser. Anything not named here is dropped, so a new Faro field
// or instrumentation sends nothing until it is added on purpose.

import type {
  APIEvent,
  EventEvent,
  ExceptionEvent,
  ExceptionStackFrame,
  MeasurementEvent,
  Meta,
  TraceEvent,
  TransportItem,
} from '@grafana/faro-web-sdk'
import { appEventAttributes } from './events'
import { redact, redactUrl } from './redact'
import { supabaseTarget } from './supabaseTarget'

/** reportError's context. */
const EXCEPTION_CONTEXT = ['source']

// Web vitals values are numbers; their context may also name DOM elements and
// resource URLs (attribution), which are left out.
const VITALS_CONTEXT = [
  'id',
  'rating',
  'navigation_type',
  'navigation_entry_id',
  'load_state',
  'interaction_type',
]

const RESOURCE_PREFIXES = [
  'service.',
  'deployment.',
  'browser.',
  'telemetry.',
  'process.runtime.',
  'user_agent.',
]

// Span attributes as OTLP JSON (the fetch instrumentation sets either the old
// or the stable semantic-convention names).
const SPAN_KEEP = new Set([
  'http.method',
  'http.request.method',
  'http.status_code',
  'http.response.status_code',
  'http.scheme',
  'http.host',
  'server.address',
  'server.port',
  'url.scheme',
  'session.id',
])
const SPAN_URL_KEYS = ['http.url', 'url.full']

const OFFLINE_FAILURE =
  /failed to fetch|networkerror|load failed|network request failed|AuthRetryableFetchError/i

export interface SanitizeOptions {
  /** VITE_SUPABASE_URL: spans and fetch events for other hosts are dropped. */
  supabaseUrl: string
  /** navigator.onLine, read when the item is sent. */
  online: boolean
}

type Attributes = Record<string, string>

function pick(
  source: Attributes | undefined,
  keys: readonly string[],
  clean = redact,
): Attributes | undefined {
  if (!source) return undefined
  const out: Attributes = {}
  for (const key of keys) {
    if (source[key] != null) out[key] = clean(source[key])
  }
  return Object.keys(out).length ? out : undefined
}

function method(value: unknown): string {
  const m = String(value ?? '').toUpperCase()
  return /^[A-Z]{3,7}$/.test(m) ? m : 'OTHER'
}

export function sanitizeMeta(meta: Meta): Meta {
  const out: Meta = {}
  if (meta.sdk) out.sdk = { name: meta.sdk.name, version: meta.sdk.version }
  // Our own values (name, VITE_APP_VERSION, VITE_APP_ENV), set in index.ts.
  if (meta.app)
    out.app = { name: meta.app.name, version: meta.app.version, environment: meta.app.environment }
  if (meta.session) {
    // isSampled is read by Faro's own session hook, which runs after this one.
    out.session = {
      id: meta.session.id,
      attributes: pick(meta.session.attributes, ['isSampled', 'previousSession']),
    }
  }
  if (meta.page?.url) out.page = { url: redactUrl(meta.page.url) }
  if (meta.view?.name) out.view = { name: redact(meta.view.name) }
  if (meta.browser) {
    const { name, version, os, mobile, userAgent, language, viewportWidth, viewportHeight } =
      meta.browser
    out.browser = { name, version, os, mobile, userAgent, language, viewportWidth, viewportHeight }
  }
  if (meta.os) out.os = { name: meta.os.name, version: meta.os.version }
  // Never: user (setUser is never called, and it would be dropped here), k6, device ids.
  return out
}

function sanitizeFrame(frame: ExceptionStackFrame): ExceptionStackFrame {
  const filename = /^[a-z][a-z0-9+.-]*:\/\//i.test(frame.filename)
    ? redactUrl(frame.filename)
    : redact(frame.filename)
  return { filename, function: redact(frame.function), lineno: frame.lineno, colno: frame.colno }
}

function sanitizeException(payload: ExceptionEvent, online: boolean): ExceptionEvent | null {
  // The PWA is used offline; a fetch failing then is expected, not a bug.
  if (!online && OFFLINE_FAILURE.test(`${payload.type} ${payload.value}`)) return null
  return {
    type: redact(payload.type),
    value: redact(payload.value),
    timestamp: payload.timestamp,
    fatal: payload.fatal,
    trace: payload.trace,
    stacktrace: payload.stacktrace && {
      frames: payload.stacktrace.frames.slice(0, 50).map(sanitizeFrame),
    },
    context: pick(payload.context, EXCEPTION_CONTEXT),
  }
}

function fetchEvent(payload: EventEvent, supabaseUrl: string): EventEvent | null {
  const attrs = payload.attributes ?? {}
  const url = SPAN_URL_KEYS.map((k) => attrs[k]).find(Boolean)
  const target = url ? supabaseTarget(url, supabaseUrl) : null
  if (!target) return null
  const status = attrs['http.status_code'] ?? attrs['http.response.status_code']
  const attributes: Attributes = {
    target,
    method: method(attrs['http.method'] ?? attrs['http.request.method']),
  }
  if (status && /^\d{1,3}$/.test(status)) attributes.status = status
  if (attrs.duration_ns && /^\d+$/.test(attrs.duration_ns))
    attributes.duration_ns = attrs.duration_ns
  return {
    name: payload.name,
    domain: payload.domain,
    timestamp: payload.timestamp,
    trace: payload.trace,
    attributes,
  }
}

function sanitizeEvent(payload: EventEvent, supabaseUrl: string): EventEvent | null {
  const base = {
    name: payload.name,
    domain: payload.domain,
    timestamp: payload.timestamp,
    trace: payload.trace,
  }
  if (payload.name.startsWith('faro.tracing.')) return fetchEvent(payload, supabaseUrl)
  if (
    payload.name === 'session_start' ||
    payload.name === 'session_resume' ||
    payload.name === 'session_extend'
  ) {
    return base
  }
  if (payload.name === 'view_changed')
    return { ...base, attributes: pick(payload.attributes, ['fromView', 'toView']) }
  const allowed = appEventAttributes(payload.name)
  if (allowed) return { ...base, attributes: pick(payload.attributes, allowed) }
  return null
}

function sanitizeMeasurement(payload: MeasurementEvent): MeasurementEvent | null {
  if (payload.type !== 'web-vitals') return null
  const values: Record<string, number> = {}
  for (const [key, value] of Object.entries(payload.values)) {
    if (typeof value === 'number' && Number.isFinite(value)) values[key] = value
  }
  return {
    type: payload.type,
    values,
    timestamp: payload.timestamp,
    trace: payload.trace,
    context: pick(payload.context, VITALS_CONTEXT),
  }
}

// OTLP JSON, loosely typed: only the fields read or written here.
interface KeyValue {
  key: string
  value: {
    stringValue?: string
    intValue?: number | string
    boolValue?: boolean
    doubleValue?: number
  }
}
interface Span {
  name: string
  attributes?: KeyValue[]
  events?: unknown[]
  links?: { attributes?: KeyValue[] }[]
  status?: { code?: number; message?: string }
  droppedEventsCount?: number
}
interface ResourceSpans {
  resource?: { attributes?: KeyValue[] }
  scopeSpans?: { scope?: unknown; spans?: Span[] }[]
}

function stringOf(kv: KeyValue | undefined): string | undefined {
  const v = kv?.value
  if (!v) return undefined
  return v.stringValue ?? (v.intValue != null ? String(v.intValue) : undefined)
}

function sanitizeSpan(span: Span, supabaseUrl: string): Span | null {
  const attrs = span.attributes ?? []
  const url = SPAN_URL_KEYS.map((k) => stringOf(attrs.find((a) => a.key === k))).find(Boolean)
  const target = url ? supabaseTarget(url, supabaseUrl) : null
  if (!target || !url) return null
  const verb = method(
    stringOf(attrs.find((a) => a.key === 'http.method' || a.key === 'http.request.method')),
  )
  const attributes: KeyValue[] = []
  for (const a of attrs) {
    if (SPAN_KEEP.has(a.key)) {
      attributes.push(
        a.value.stringValue != null
          ? { key: a.key, value: { stringValue: redact(a.value.stringValue) } }
          : a,
      )
    } else if (SPAN_URL_KEYS.includes(a.key)) {
      attributes.push({ key: a.key, value: { stringValue: redactUrl(url) } })
    }
  }
  attributes.push({ key: 'supabase.target', value: { stringValue: target } })
  return {
    ...span,
    name: `${verb} ${target}`,
    attributes,
    events: [],
    droppedEventsCount: 0,
    links: span.links?.map((l) => ({ ...l, attributes: [] })),
    status: span.status && {
      code: span.status.code,
      ...(span.status.message ? { message: redact(span.status.message) } : {}),
    },
  }
}

function sanitizeTraces(payload: TraceEvent, supabaseUrl: string): TraceEvent | null {
  const resourceSpans: ResourceSpans[] = []
  for (const rs of (payload.resourceSpans ?? []) as ResourceSpans[]) {
    const scopeSpans = (rs.scopeSpans ?? [])
      .map((ss) => ({
        ...ss,
        spans: (ss.spans ?? [])
          .map((s) => sanitizeSpan(s, supabaseUrl))
          .filter((s): s is Span => s != null),
      }))
      .filter((ss) => ss.spans.length > 0)
    if (scopeSpans.length === 0) continue
    const attributes = (rs.resource?.attributes ?? [])
      .filter((a) => RESOURCE_PREFIXES.some((p) => a.key.startsWith(p)))
      .map((a) =>
        a.value.stringValue != null
          ? { key: a.key, value: { stringValue: a.value.stringValue.slice(0, 300) } }
          : a,
      )
    resourceSpans.push({ ...rs, resource: { ...rs.resource, attributes }, scopeSpans })
  }
  return resourceSpans.length ? ({ resourceSpans } as TraceEvent) : null
}

/** The beforeSend hook: an allow-listed copy of the item, or null to drop it. */
export function sanitizeItem(
  item: TransportItem<APIEvent>,
  options: SanitizeOptions,
): TransportItem<APIEvent> | null {
  let payload: APIEvent | null
  switch (item.type as string) {
    case 'exception':
      payload = sanitizeException(item.payload as ExceptionEvent, options.online)
      break
    case 'event':
      payload = sanitizeEvent(item.payload as EventEvent, options.supabaseUrl)
      break
    case 'measurement':
      payload = sanitizeMeasurement(item.payload as MeasurementEvent)
      break
    case 'trace':
      payload = sanitizeTraces(item.payload as TraceEvent, options.supabaseUrl)
      break
    default:
      // Logs (console capture is off) and anything newer.
      payload = null
  }
  return payload && { type: item.type, payload, meta: sanitizeMeta(item.meta) }
}
