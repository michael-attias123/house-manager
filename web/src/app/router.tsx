import { createBrowserRouter, Navigate } from 'react-router-dom'
import { RouteError } from '@/components/ErrorBoundary'
import { DashboardPage } from './DashboardPage'
import { FEATURES } from './features'
import { Layout } from './Layout'
import { MorePage } from './MorePage'

export function createAppRouter() {
  return createBrowserRouter([
    {
      element: <Layout />,
      errorElement: <RouteError />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'more', element: <MorePage /> },
        ...FEATURES.flatMap((f) => f.routes),
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ])
}
