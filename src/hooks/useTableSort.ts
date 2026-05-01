import { useState, useMemo } from 'react'

export type SortDir = 'asc' | 'desc'

export interface SortState<K extends string> {
  key:    K | null
  dir:    SortDir
}

export function useTableSort<T, K extends string>(
  rows: T[],
  accessor: (row: T, key: K) => string | number | null | undefined,
) {
  const [sort, setSort] = useState<SortState<K>>({ key: null, dir: 'asc' })

  const toggle = (key: K) => {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    )
  }

  const sorted = useMemo(() => {
    if (!sort.key) return rows
    const k = sort.key
    return [...rows].sort((a, b) => {
      const av = accessor(a, k) ?? ''
      const bv = accessor(b, k) ?? ''
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, accessor])

  return { sorted, sort, toggle }
}
