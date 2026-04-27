import { clsx } from 'clsx'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed',
        {
          'bg-terminal-teal text-white hover:bg-terminal-teal-light focus:ring-terminal-teal':
            variant === 'primary',
          'bg-terminal-navy-light text-white border border-terminal-navy-border hover:bg-terminal-navy-border focus:ring-terminal-navy-border':
            variant === 'secondary',
          'text-terminal-teal hover:bg-terminal-teal/10 focus:ring-terminal-teal':
            variant === 'ghost',
        },
        {
          'px-3 py-1.5 text-xs rounded': size === 'sm',
          'px-4 py-2 text-sm rounded': size === 'md',
          'px-6 py-3 text-sm rounded-md': size === 'lg',
        },
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
