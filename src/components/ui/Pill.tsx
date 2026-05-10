/**
 * Endenex Pill — unified toggle / status pill component.
 *
 * Two variants:
 *   - <PillToggle>     for filter toggles (selected vs unselected state)
 *   - <PillStatus>     for read-only category / status badges
 *
 * Both use Endenex brand styling: navy on selected, soft cream on
 * unselected, teal accent on hover. Replaces the dozens of inline
 * `bg-active text-teal` patterns scattered across pages.
 */

import { clsx } from 'clsx'
import type { ReactNode, MouseEventHandler } from 'react'

// ── PillToggle — clickable, selectable filter pill ───────────────────

interface PillToggleProps {
  selected:    boolean
  onClick:     MouseEventHandler<HTMLButtonElement>
  children:    ReactNode
  /** Pill weight. 'normal' for labels, 'bold' for region codes. */
  weight?:     'normal' | 'bold'
  title?:      string
  className?:  string
}

export function PillToggle({
  selected, onClick, children, weight = 'normal', title, className,
}: PillToggleProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        'px-1.5 py-0.5 text-[10px] tracking-wide rounded-sm transition-colors',
        weight === 'bold' ? 'font-bold' : 'font-semibold',
        selected
          ? 'bg-[#0A1628] text-white border border-[#0A1628]'
          : 'bg-[#F7F4EF] text-[#8C8880] border border-[#D8D3CB] hover:text-[#007B8A] hover:border-[#007B8A]/60',
        className,
      )}>
      {children}
    </button>
  )
}

// ── PillToggleGroup — typical row of segmented toggles ──────────────

interface PillToggleGroupProps<T extends string> {
  options:   readonly { code: T; label: string }[]
  value:     T
  onChange:  (next: T) => void
  weight?:   'normal' | 'bold'
}

export function PillToggleGroup<T extends string>({
  options, value, onChange, weight,
}: PillToggleGroupProps<T>) {
  return (
    <div className="flex items-center gap-1">
      {options.map(o => (
        <PillToggle key={o.code} selected={value === o.code} onClick={() => onChange(o.code)} weight={weight}>
          {o.label}
        </PillToggle>
      ))}
    </div>
  )
}

// ── PillStatus — read-only status / category badge ──────────────────

type PillTone =
  | 'navy'      // primary
  | 'teal'      // accent
  | 'gold'      // highlight
  | 'grey'      // muted
  | 'success'   // confident / green
  | 'warning'   // plausible / amber
  | 'danger'    // banned / restricted / waste / red
  | 'ghost'     // borderless faint

const STATUS_TONE_CLS: Record<PillTone, string> = {
  navy:    'bg-[#0A1628] text-white border-[#0A1628]',
  teal:    'bg-[#007B8A] text-white border-[#007B8A]',
  gold:    'bg-[#C4863A]/15 text-[#C4863A] border-[#C4863A]/40',
  grey:    'bg-[#F7F4EF] text-[#8C8880] border-[#D8D3CB]',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger:  'bg-rose-50 text-rose-700 border-rose-200',
  ghost:   'bg-transparent text-[#8C8880] border-transparent',
}

interface PillStatusProps {
  tone?:      PillTone
  children:   ReactNode
  /** Smaller variant for inline use in tables. */
  size?:      'xs' | 'sm'
  className?: string
}

export function PillStatus({
  tone = 'navy', children, size = 'sm', className,
}: PillStatusProps) {
  return (
    <span
      className={clsx(
        'inline-block px-1 py-px font-bold rounded-sm border tracking-wider',
        size === 'xs' ? 'text-[8px]' : 'text-[10px]',
        STATUS_TONE_CLS[tone],
        className,
      )}>
      {children}
    </span>
  )
}
