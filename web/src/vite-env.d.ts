/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_VAPID_PUBLIC_KEY?: string
  readonly VITE_DEMO?: string
  /** Grafana Faro collector URL; empty = telemetry off. */
  readonly VITE_FARO_URL?: string
  /** Set in vite.config.ts: 'production' only for the production branch on Cloudflare Pages. */
  readonly VITE_APP_ENV: string
  /** Set in vite.config.ts from CF_PAGES_COMMIT_SHA; empty outside Cloudflare Pages. */
  readonly VITE_APP_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
