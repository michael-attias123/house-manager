import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  // `pnpm build:demo`: runs in the browser on sample data (src/demo), no
  // Supabase needed, from any static host or sub-path.
  const demo = mode === 'demo'
  // Cloudflare Pages sets CF_PAGES, CF_PAGES_BRANCH and CF_PAGES_COMMIT_SHA;
  // infra/ sets PRODUCTION_BRANCH. Telemetry sends only from 'production'
  // (src/lib/telemetry), so preview deployments stay silent.
  const branch = process.env.CF_PAGES_BRANCH
  const appEnv =
    branch && branch === process.env.PRODUCTION_BRANCH ? 'production' : process.env.CF_PAGES ? 'preview' : mode
  return {
    base: demo ? './' : '/',
    define: {
      'import.meta.env.VITE_APP_ENV': JSON.stringify(appEnv),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.CF_PAGES_COMMIT_SHA ?? ''),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        disable: demo,
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'ניהול הבית',
          short_name: 'הבית',
          description: 'רשימת קניות, התחשבנות, חשבונות ומטלות — לבית משותף',
          lang: 'he',
          dir: 'rtl',
          start_url: '/',
          display: 'standalone',
          background_color: '#f8fafc',
          theme_color: '#0f766e',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // The app shell is precached and served as '/', never '/index.html':
          // Cloudflare Pages redirects /index.html → /, and a navigation answered
          // with a redirected response fails ("Response served by service worker
          // has redirections" in Safari). That happens whenever the precache is
          // missing, e.g. after Safari clears a site's storage, and the worker
          // falls back to the network.
          navigateFallback: '/',
          manifestTransforms: [
            (entries) => ({
              manifest: entries.map((e) => (e.url === 'index.html' ? { ...e, url: '/' } : e)),
              warnings: [],
            }),
          ],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Web Push (public/push-handler.js), resolved next to sw.js.
          importScripts: ['push-handler.js'],
        },
      }),
    ],
    resolve: {
      alias: [
        ...(demo
          ? [
              {
                find: /^@\/lib\/supabase$/,
                replacement: fileURLToPath(new URL('./src/demo/supabase.ts', import.meta.url)),
              },
              {
                find: /^@\/lib\/telemetry$/,
                replacement: fileURLToPath(new URL('./src/demo/telemetry.ts', import.meta.url)),
              },
            ]
          : []),
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      ],
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
