import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { reportError } from '@/lib/telemetry'
import { Button } from './ui/Button'
import { ErrorBox } from './ui/Feedback'

interface Props {
  children: ReactNode
  /** Rendered instead of the default message; null hides the failed part. */
  fallback?: ReactNode
}

/** Keeps one failing feature (e.g. a dashboard widget) from breaking the page. */
export class ErrorBoundary extends Component<Props, { error: unknown }> {
  state = { error: null as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack)
    reportError(error, { source: 'error_boundary' })
  }

  render() {
    if (this.state.error == null) return this.props.children
    return this.props.fallback !== undefined ? this.props.fallback : <ErrorBox error={this.state.error} />
  }
}

export function RouteError() {
  const error = useRouteError()
  useEffect(() => reportError(error, { source: 'route_error' }), [error])
  return (
    <div className="mx-auto max-w-md space-y-3 p-6">
      <h1 className="text-lg font-semibold">משהו השתבש</h1>
      <ErrorBox error={error} />
      <Button onClick={() => window.location.reload()}>טעינה מחדש</Button>
    </div>
  )
}
