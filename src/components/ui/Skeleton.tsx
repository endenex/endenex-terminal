import { clsx } from 'clsx'

// Single shimmer bar — uses page (slightly grey) for contrast on white panels
export function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={clsx('animate-pulse bg-page rounded-sm', className)} />
  )
}

export function SkeletonFeedRow() {
  return (
    <div className="px-2.5 py-2 border-b border-border">
      <div className="flex items-center gap-2 mb-1.5">
        <SkeletonBar className="h-2.5 w-14" />
        <SkeletonBar className="h-3 w-16 rounded-sm" />
        <SkeletonBar className="h-2.5 w-20" />
        <SkeletonBar className="h-2.5 w-8 ml-auto" />
      </div>
      <SkeletonBar className="h-3 w-4/5 mb-1" />
      <SkeletonBar className="h-2.5 w-2/3" />
    </div>
  )
}

export function SkeletonPriceRow() {
  return (
    <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border last:border-0">
      <SkeletonBar className="h-2.5 w-28" />
      <div className="flex items-center gap-2">
        <SkeletonBar className="h-2.5 w-16" />
        <SkeletonBar className="h-2.5 w-10" />
      </div>
    </div>
  )
}

export function SkeletonTableRow({ cols = 6 }: { cols?: number }) {
  const widths = ['w-32', 'w-16', 'w-14', 'w-20', 'w-14', 'w-12', 'w-16', 'w-14']
  return (
    <tr className="border-b border-border">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className={i === 0 ? 'pl-2.5 py-1.5 pr-2' : 'py-1.5 pr-2'}>
          <SkeletonBar className={clsx('h-2.5 animate-pulse', widths[i % widths.length])} />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonCompactRow() {
  return (
    <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border last:border-0">
      <div className="space-y-1">
        <SkeletonBar className="h-2.5 w-32" />
        <SkeletonBar className="h-2 w-20" />
      </div>
      <SkeletonBar className="h-3.5 w-12 rounded-sm" />
    </div>
  )
}
