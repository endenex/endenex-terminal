import { clsx } from 'clsx'

// Single shimmer bar
export function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={clsx('animate-pulse bg-terminal-surface rounded', className)} />
  )
}

// A row that mimics a data feed item: meta strip + headline + summary
export function SkeletonFeedRow() {
  return (
    <div className="px-5 py-4 border-b border-terminal-border">
      <div className="flex items-center gap-2 mb-2.5">
        <SkeletonBar className="h-3 w-16" />
        <SkeletonBar className="h-4 w-20 rounded-sm" />
        <SkeletonBar className="h-3 w-24" />
        <SkeletonBar className="h-3 w-10 ml-auto" />
      </div>
      <SkeletonBar className="h-3.5 w-4/5 mb-1.5" />
      <SkeletonBar className="h-3 w-2/3" />
    </div>
  )
}

// A row that mimics a price table row: label | value | date
export function SkeletonPriceRow() {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border last:border-0">
      <SkeletonBar className="h-3 w-32" />
      <div className="flex items-center gap-3">
        <SkeletonBar className="h-3 w-20" />
        <SkeletonBar className="h-3 w-12" />
      </div>
    </div>
  )
}

// A row that mimics a table data row (projects, generic)
export function SkeletonTableRow({ cols = 6 }: { cols?: number }) {
  const widths = ['w-40', 'w-20', 'w-16', 'w-24', 'w-16', 'w-14', 'w-20', 'w-16']
  return (
    <tr className="border-b border-terminal-border">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className={i === 0 ? 'pl-6 py-3 pr-3' : 'py-3 pr-3'}>
          <SkeletonBar className={clsx('h-3 animate-pulse', widths[i % widths.length])} />
        </td>
      ))}
    </tr>
  )
}

// A compact row for dashboard panels (project name + stage badge)
export function SkeletonCompactRow() {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-terminal-border last:border-0">
      <div className="space-y-1.5">
        <SkeletonBar className="h-3 w-36" />
        <SkeletonBar className="h-2.5 w-24" />
      </div>
      <SkeletonBar className="h-5 w-16 rounded" />
    </div>
  )
}
