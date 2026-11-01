// Replaces src/lib/telemetry in the demo build (see vite.config.ts): the demo
// sends nothing anywhere, and its bundle holds no Faro code or collector URL.
import type { AppEventAttributes, AppEventName, ErrorSource } from '@/lib/telemetry/events'

export function initTelemetry(): void {}

export function reportError(_error: unknown, _context: { source: ErrorSource }): void {}

export function reportEvent<N extends AppEventName>(
  _name: N,
  _attributes: AppEventAttributes<N>,
): void {}

export function reportPageView(_path: string): void {}
