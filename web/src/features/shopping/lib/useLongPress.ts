import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

const MOVE_TOLERANCE = 8

/**
 * Pointer handlers that call `onLongPress` after `ms` of holding still.
 * Scrolling cancels it, and the click that ends a long press is swallowed,
 * so holding an item does not also check it off.
 */
export function useLongPress(onLongPress: () => void, ms = 450) {
  const callback = useRef(onLongPress)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const start = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  useEffect(() => {
    callback.current = onLongPress
  }, [onLongPress])

  useEffect(() => () => clearTimeout(timer.current), [])

  const cancel = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    start.current = null
  }

  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      fired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fired.current = true
        start.current = null
        navigator.vibrate?.(10)
        callback.current()
      }, ms)
    },
    onPointerMove: (e: PointerEvent) => {
      const from = start.current
      if (from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Android opens a context menu on a long press; iOS a text callout (CSS).
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClickCapture: (e: MouseEvent) => {
      if (!fired.current) return
      fired.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
}
