import {
  ErrorsInstrumentation,
  initializeFaro,
  SessionInstrumentation,
  ViewInstrumentation,
  WebVitalsInstrumentation,
  type Faro,
} from '@grafana/faro-web-sdk'
import { TracingInstrumentation } from '@grafana/faro-web-tracing'
import type { AppEventAttributes, AppEventName, ErrorSource } from './events'
import { sanitizeItem } from './sanitize'

// Real-user monitoring (Grafana Faro): errors, web vitals, page views and
// Supabase request spans, from production builds only. Everything passes
// through sanitize.ts (an allow-list) and redact.ts on its way out.
// The demo build resolves this module to src/demo/telemetry.ts instead
// (vite.config.ts), so it contains no Faro code at all.

const FARO_URL = String(import.meta.env.VITE_FARO_URL ?? '').trim()
const APP_ENV = import.meta.env.VITE_APP_ENV
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()

let faro: Faro | null = null

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Starts Faro when VITE_FARO_URL is set and this is the production build; otherwise does nothing. */
export function initTelemetry(): void {
  if (faro || !FARO_URL || APP_ENV !== 'production' || !SUPABASE_URL) return
  let supabaseOrigin: string
  try {
    supabaseOrigin = new URL(SUPABASE_URL).origin
  } catch {
    return
  }
  // The Data API and Auth; not Realtime, Storage or Functions.
  const supabaseApi = `${escapeRegExp(supabaseOrigin)}/(?:rest|auth)/v1/`
  try {
    faro = initializeFaro({
      url: FARO_URL,
      app: {
        name: 'house-manager',
        version: import.meta.env.VITE_APP_VERSION || 'dev',
        environment: APP_ENV,
      },
      sessionTracking: { enabled: true, samplingRate: 1 },
      // Picked one by one instead of getWebInstrumentations(): no console
      // capture, no resource or navigation timings (PostgREST URLs carry
      // filter values), no user actions or frustration clicks, no CSP reports.
      instrumentations: [
        new ErrorsInstrumentation(),
        new WebVitalsInstrumentation(),
        new SessionInstrumentation(),
        new ViewInstrumentation(),
        new TracingInstrumentation({
          instrumentationOptions: { propagateTraceHeaderCorsUrls: [new RegExp(`^${supabaseApi}`)] },
        }),
      ],
      // Requests to anything but the Supabase API get no span at all.
      ignoreUrls: [new RegExp(`^(?!${supabaseApi})`)],
      // Fetch failures while offline are dropped in sanitize.ts, which can
      // read navigator.onLine at the time; patterns here are fixed.
      ignoreErrors: [/ResizeObserver loop/],
      trackResources: false,
      trackGeolocation: false,
      webVitalsInstrumentation: { trackAttributionSources: false },
      preventGlobalExposure: true,
      beforeSend: (item) =>
        sanitizeItem(item, { supabaseUrl: supabaseOrigin, online: navigator.onLine !== false }),
      // Never setUser: the session id is random and is the only identifier.
    })
  } catch {
    faro = null
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') {
    // Plain objects: Supabase errors ({ message, code }) and router responses ({ status }).
    const e = error as { message?: unknown; status?: unknown; statusText?: unknown }
    if (typeof e.message === 'string') return new Error(e.message)
    if (typeof e.status === 'number')
      return new Error(`HTTP ${e.status} ${String(e.statusText ?? '')}`.trim())
  }
  return new Error(typeof error === 'string' ? error : 'Unknown error')
}

/** An error caught by the app (error boundaries); uncaught ones are reported by Faro itself. */
export function reportError(error: unknown, context: { source: ErrorSource }): void {
  faro?.api.pushError(toError(error), { context: { source: context.source } })
}

/** One of the app's own events (events.ts lists them and the attributes each may carry). */
export function reportEvent<N extends AppEventName>(
  name: N,
  attributes: AppEventAttributes<N>,
): void {
  faro?.api.pushEvent(name, attributes)
}

/** The current route path (no query string or hash), as Faro's view: one page view per change. */
export function reportPageView(path: string): void {
  faro?.api.setView({ name: path })
}
