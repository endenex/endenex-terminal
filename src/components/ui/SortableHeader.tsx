import { clsx } from 'clsx'
import type { SortState } from '@/hooks/useTableSort'

interface SortableThProps<K extends string> {
  label:      string
  sortKey:    K
  sort:       SortState<K>
  onSort:     (key: K) => void
  className?: string
}

export function SortableTh<K extends string>({
  label, sortKey, sort, onSort, className,
}: SortableThProps<K>) {
  const active = sort.key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={clsx(
        'text-[10.5px] font-semibold tracking-wide uppercase cursor-pointer select-none px-2.5 py-1.5 text-left bg-titlebar border-b border-border',
        'hover:text-ink transition-colors group',
        active ? 'text-teal' : 'text-ink-3',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={clsx(
          'text-[9px] transition-opacity',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40',
          active && sort.dir === 'desc' ? 'rotate-180' : '',
        )}>
          ▲
        </span>
      </span>
    </th>
  )
}
