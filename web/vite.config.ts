import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  // `pnpm build:demo`: runs in the browser on sample data (src/demo), no
  // Supabase needed, from any static host or sub-path.
  const demo = mode === 'demo'
  return {
    base: demo ? './' : '/',
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
          navigateFallback: '/index.html',
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
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
