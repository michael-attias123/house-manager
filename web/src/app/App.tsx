import { lazy, Suspense, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { ErrorBox, Loading } from '@/components/ui/Feedback'
import { AuthProvider, useAuth } from '@/features/household/AuthProvider'
import { HouseholdProvider, useMyHouseholdQuery } from '@/features/household/HouseholdProvider'
import { LoginPage } from '@/features/household/LoginPage'
import { OnboardingPage } from '@/features/household/OnboardingPage'
import { createAppRouter } from './router'
import type { User } from '@supabase/supabase-js'

const DemoBanner = import.meta.env.VITE_DEMO === '1' ? lazy(() => import('@/demo/DemoBanner')) : null

export function App() {
  if (!isSupabaseConfigured) return <SetupNotice />
  return (
    <AuthProvider>
      {DemoBanner && (
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
      )}
      <AuthGate />
    </AuthProvider>
  )
}

function AuthGate() {
  const { session, loading } = useAuth()
  if (loading) return <Loading />
  if (!session) return <LoginPage />
  return <HouseholdGate user={session.user} />
}

function HouseholdGate({ user }: { user: User }) {
  const household = useMyHouseholdQuery(user.id)
  const [router] = useState(createAppRouter)
  if (household.isPending) return <Loading />
  if (household.error) {
    return (
      <div className="p-6">
        <ErrorBox error={household.error} />
      </div>
    )
  }
  if (!household.data) return <OnboardingPage user={user} />
  return (
    <HouseholdProvider user={user} household={household.data}>
      <RouterProvider router={router} />
    </HouseholdProvider>
  )
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-md space-y-3 p-6">
      <h1 className="text-xl font-bold">כמעט מוכן 🛠️</h1>
      <p className="text-ink-2">
        חסרים פרטי החיבור ל-Supabase. צרו את הקובץ <code dir="ltr">web/.env.local</code> לפי{' '}
        <code dir="ltr">web/.env.example</code>, או הגדירו את המשתנים ב-Cloudflare Pages. ההוראות המלאות
        ב-<code dir="ltr">docs/setup.md</code>.
      </p>
    </div>
  )
}
