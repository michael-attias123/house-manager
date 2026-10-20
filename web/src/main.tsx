import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { registerSW } from 'virtual:pwa-register'
import { persister, queryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { App } from '@/app/App'
import './index.css'

// An installed PWA resumes from the background instead of reloading, so it
// would only look for a new version after being closed. Check on every
// return to the foreground and hourly; autoUpdate then reloads the page.
registerSW({
  immediate: true,
  // A reload while the sign-in redirect (?code=) is being exchanged aborts the
  // exchange and loses the sign-in, so let the auth client settle first.
  onNeedReload() {
    void supabase.auth.initialize().finally(() => window.location.reload())
  },
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const check = () => {
      if (navigator.onLine) registration.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    setInterval(check, 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 7 }}>
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
)
