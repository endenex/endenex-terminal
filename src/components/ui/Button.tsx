import { clsx } from 'clsx'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?:    'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'primary',
  size    = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-semibold transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed rounded-sm border tracking-wide uppercase',
        {
          'bg-teal text-white border-teal hover:bg-teal-bright hover:border-teal-bright':
            variant === 'primary',
          'bg-panel text-ink-2 border-border hover:bg-raised hover:text-ink hover:border-border-strong':
            variant === 'secondary',
          'text-teal border-transparent hover:bg-teal-dim':
            variant === 'ghost',
        },
        {
          'px-2 py-0.5 text-[11px]':   size === 'sm',
          'px-3 py-1   text-[12px]':   size === 'md',
          'px-4 py-1.5 text-[13px]':   size === 'lg',
        },
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
