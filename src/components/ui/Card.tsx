import { clsx } from 'clsx'

interface CardProps {
  children:   React.ReactNode
  className?: string
}

export function Card({ children, className }: CardProps) {
  return (
    <div className={clsx('bg-panel border border-border rounded-sm', className)}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className }: CardProps) {
  return (
    <div className={clsx('px-2.5 h-7 flex items-center border-b border-border bg-titlebar', className)}>
      {children}
    </div>
  )
}

export function CardContent({ children, className }: CardProps) {
  return (
    <div className={clsx('p-2.5', className)}>
      {children}
    </div>
  )
}
