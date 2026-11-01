// OpenTelemetry spans from Edge Functions. Supabase's own runtime telemetry
// cannot be pointed at our collector on hosted projects, so a function
// exports its spans itself: to ${OTLP_ENDPOINT}/v1/traces (Grafana Cloud's
// OTLP gateway, protobuf) with `Authorization: Basic ${OTLP_BASIC_AUTH}`.
// Both secrets are set by infra/; without either one, every span is a no-op
// and nothing is sent (local runs, forks).
//
// Allow-listed attributes only: counts, durations, push service hosts, HTTP
// status codes and links to other traces. Never notification titles, bodies
// or tags, user ids, push endpoints or error text.
//
// sdk-trace is the current name of sdk-trace-base (deprecated in 2.12.0, same
// code); the exporter is the release built on that same sdk-trace version.
import {
  type Attributes,
  context,
  isValidSpanId,
  isValidTraceId,
  type Link,
  type Span,
  SpanStatusCode,
  trace,
  type Tracer,
} from 'npm:@opentelemetry/api@1.9.1'
import { BatchSpanProcessor, TracerProvider } from 'npm:@opentelemetry/sdk-trace@2.12.0'
import { OTLPTraceExporter } from 'npm:@opentelemetry/exporter-trace-otlp-proto@0.223.0'
import { resourceFromAttributes } from 'npm:@opentelemetry/resources@2.12.0'

export type { Span }

/** One per isolate, built on first use; null when telemetry is off. */
let provider: TracerProvider | null | undefined

function getProvider(service: string): TracerProvider | null {
  if (provider !== undefined) return provider
  const endpoint = Deno.env.get('OTLP_ENDPOINT')?.trim().replace(/\/+$/, '')
  const auth = Deno.env.get('OTLP_BASIC_AUTH')?.trim()
  if (!endpoint || !auth) {
    provider = null
    return provider
  }
  const exporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers: { Authorization: `Basic ${auth}` },
    timeoutMillis: 5000,
  })
  provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': service }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  })
  return provider
}

/** The function's tracer; a no-op one when telemetry is off. */
export function getTracer(service: string): Tracer {
  return getProvider(service)?.getTracer(service) ?? trace.getTracer(service)
}

/**
 * Starts a span, as a child of `parent` when given. The parent is passed
 * explicitly: no global context manager is registered.
 */
export function startSpan(tracer: Tracer, name: string, attributes?: Attributes, parent?: Span): Span {
  const ctx = parent ? trace.setSpan(context.active(), parent) : context.active()
  return tracer.startSpan(name, { attributes }, ctx)
}

/** Marks a span as failed, with the error's type only (its message may hold data). */
export function markError(span: Span, error: unknown): void {
  span.setStatus({ code: SpanStatusCode.ERROR })
  span.setAttribute('error.type', error instanceof Error ? error.name : typeof error)
}

/** Runs `fn` in a span that ends when it settles. */
export async function inSpan<T>(
  tracer: Tracer,
  name: string,
  parent: Span | undefined,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = startSpan(tracer, name, undefined, parent)
  try {
    return await fn(span)
  } catch (error) {
    markError(span, error)
    throw error
  } finally {
    span.end()
  }
}

/**
 * Sends the spans recorded so far, in EdgeRuntime.waitUntil, so the response
 * never waits for it. Export errors are dropped: telemetry never fails a run.
 */
export function flush(): void {
  if (!provider) return
  const done = provider.forceFlush().catch(() => {})
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime
  runtime?.waitUntil(done)
}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

/**
 * A span link to the trace named by a W3C traceparent (ids only), or null
 * when it is missing or invalid.
 */
export function linkFromTraceparent(traceparent: unknown): Link | null {
  if (typeof traceparent !== 'string') return null
  const m = TRACEPARENT.exec(traceparent)
  if (!m || m[1] === 'ff' || !isValidTraceId(m[2]) || !isValidSpanId(m[3])) return null
  return { context: { traceId: m[2], spanId: m[3], traceFlags: parseInt(m[4], 16) & 1, isRemote: true } }
}
