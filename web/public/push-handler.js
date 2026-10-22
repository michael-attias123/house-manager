// Web Push for the installed app. Loaded into the generated service worker
// by workbox.importScripts (vite.config.ts). The payload comes from
// supabase/functions/send-push: {title, body, url, tag}.

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'ניהול הבית', {
      body: data.body || '',
      icon: '/pwa-192.png',
      // Android's status bar: a white shape on transparent.
      badge: '/badge-96.png',
      tag: data.tag || undefined,
      dir: 'rtl',
      lang: 'he',
      data: { url: data.url || '/' },
    }),
  )
})

// Opens the page the notification is about: in the app's window if one is
// open (iOS and Android keep a single one), else in a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  )
  if (target.origin !== self.location.origin) return
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin)
      if (!client) {
        await self.clients.openWindow(target.href)
        return
      }
      const focused = await client.focus().catch(() => client)
      if (new URL(focused.url).pathname !== target.pathname && 'navigate' in focused) {
        await focused.navigate(target.href).catch(() => self.clients.openWindow(target.href))
      }
    })(),
  )
})
