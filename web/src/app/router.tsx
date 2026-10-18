import { createBrowserRouter, createHashRouter, Navigate } from 'react-router-dom'
import { RouteError } from '@/components/ErrorBoundary'
import { DashboardPage } from './DashboardPage'
import { FEATURES } from './features'
import { Layout } from './Layout'
import { MorePage } from './MorePage'

// The demo is served as static files from a sub-path, so it routes by #hash.
const createRouter = import.meta.env.VITE_DEMO === '1' ? createHashRouter : createBrowserRouter

export function createAppRouter() {
  return createRouter([
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
