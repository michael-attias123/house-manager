import { useEffect, useState, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'

interface ConfirmButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  onConfirm: () => void
  children: ReactNode
  /** Shown after the first tap; a second tap within a few seconds confirms. */
  confirmLabel?: string
}

/** Two-tap confirmation, so destructive actions need no browser dialog. */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'לאשר?', ...props }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  return (
    <Button
      {...props}
      variant={armed ? 'danger' : props.variant}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  )
}
