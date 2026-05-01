import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { clsx } from 'clsx'
import { ExternalLink, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TopBar } from '@/components/layout/TopBar'
import type { TopBarMeta } from '@/components/layout/TopBar'
import { SkeletonFeedRow } from '@/components/ui/Skeleton'

// ── Types ──────────────────────────────────────────────────────────────────────

type WatchCategory = 'market' | 'regulatory' | 'commodity' | 'supply_chain'

interface WatchSource {
  id: string
  name: string
  url: string | null
}

interface WatchEvent {
  id: string
  category: WatchCategory
  event_type: string
  scope: string
  headline: string
  notes: string | null
  site_name: string | null
  developer: string | null
  company_name: string | null
  capacity_mw: number | null
  turbine_count: number | null
  event_date: string
  source_id: string | null
  source_url: string | null
  confidence: 'High' | 'Medium' | 'Low'
  last_reviewed: string
  source_count: number
  is_duplicate: boolean
  watch_sources: WatchSource | null
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES: { code: WatchCategory | 'all'; label: string }[] = [
  { code: 'all',          label: 'All' },
  { code: 'market',       label: 'Market' },
  { code: 'regulatory',   label: 'Regulatory' },
  { code: 'commodity',    label: 'Commodity' },
  { code: 'supply_chain', label: 'Supply Chain' },
]

const CATEGORY_STYLE: Record<WatchCategory, { pill: string }> = {
  market:       { pill: 'bg-blue-900/30 text-blue-400 border border-blue-700/50' },
  regulatory:   { pill: 'bg-amber-900/30 text-amber-400 border border-amber-700/50' },
  commodity:    { pill: 'bg-teal-900/30 text-teal-400 border border-teal-700/50' },
  supply_chain: { pill: 'bg-violet-900/30 text-violet-400 border border-violet-700/50' },
}

const CATEGORY_LABEL: Record<WatchCategory, string> = {
  market:       'Market',
  regulatory:   'Regulatory',
  commodity:    'Commodity',
  supply_chain: 'Supply Chain',
}

const SCOPES = ['EU', 'GB', 'US', 'DE', 'DK', 'FR', 'ES', 'Global']

const CONFIDENCE_COLOUR: Record<string, string> = {
  High:   'text-emerald-400',
  Medium: 'text-amber-400',
  Low:    'text-red-400',
}

const PAGE_SIZE = 50

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

// ── Scope dropdown ─────────────────────────────────────────────────────────────

function ScopeDropdown({ selected, onChange }: {
  selected: string[]
  onChange: (s: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (scope: string) =>
    onChange(selected.includes(scope) ? selected.filter(s => s !== scope) : [...selected, scope])

  const label =
    selected.length === 0 ? 'All scopes' :
    selected.length === 1 ? selected[0] :
    `${selected.length} scopes`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono bg-terminal-surface border border-terminal-border rounded hover:border-terminal-teal/50 text-terminal-text transition-colors"
      >
        {label}
        <ChevronDown size={11} className="text-terminal-muted" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 bg-terminal-surface border border-terminal-border rounded shadow-lg min-w-[140px]">
          {SCOPES.map(scope => (
            <button
              key={scope}
              onClick={() => toggle(scope)}
              className="flex items-center justify-between w-full px-3 py-2 text-xs font-mono text-terminal-text hover:bg-terminal-black transition-colors"
            >
              {scope}
              {selected.includes(scope) && (
                <span className="text-terminal-teal text-[10px]">✓</span>
              )}
            </button>
          ))}
          {selected.length > 0 && (
            <>
              <div className="border-t border-terminal-border" />
              <button
                onClick={() => onChange([])}
                className="w-full px-3 py-2 text-xs font-mono text-terminal-muted hover:text-terminal-text hover:bg-terminal-black transition-colors text-left"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function DetailPanel({ event, onClose }: { event: WatchEvent; onClose: () => void }) {
  const style = CATEGORY_STYLE[event.category]
  const entity = event.site_name || event.company_name || event.developer
  const sourceLink = event.source_url || event.watch_sources?.url

  return (
    <div className="w-80 flex-shrink-0 border-l border-terminal-border bg-terminal-surface flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border flex-shrink-0">
        <span className={clsx('text-[10px] font-mono px-2 py-0.5 rounded', style.pill)}>
          {CATEGORY_LABEL[event.category]}
        </span>
        <button
          onClick={onClose}
          className="text-terminal-muted hover:text-terminal-text transition-colors text-sm leading-none"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        <div>
          <p className="text-xs font-semibold text-terminal-text leading-snug mb-1">
            {event.headline}
          </p>
          <p className="text-[11px] font-mono text-terminal-muted">{event.event_type}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-1">Scope</div>
            <div className="font-mono text-terminal-text">{event.scope}</div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-1">Date</div>
            <div className="font-mono text-terminal-text">{fmtDate(event.event_date)}</div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-1">Confidence</div>
            <div className={clsx('font-mono', CONFIDENCE_COLOUR[event.confidence])}>
              {event.confidence}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-1">Reviewed</div>
            <div className="font-mono text-terminal-text">{fmtDate(event.last_reviewed)}</div>
          </div>
        </div>

        {entity && (
          <div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-1">
              {event.site_name ? 'Site' : 'Company'}
            </div>
            <div className="text-xs text-terminal-text">{entity}</div>
            {event.developer && event.site_name && (
              <div className="text-[11px] text-terminal-muted mt-0.5">{event.developer}</div>
            )}
          </div>
        )}

        {(event.capacity_mw != null || event.turbine_count != null) && (
          <div className="grid grid-cols-2 gap-3 text-xs">
            {event.capacity_mw != null && (
              <div>
                <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-1">Capacity</div>
                <div className="font-mono text-terminal-text">{event.capacity_mw} MW</div>
              </div>
            )}
            {event.turbine_count != null && (
              <div>
                <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-1">Turbines</div>
                <div className="font-mono text-terminal-text">{event.turbine_count}</div>
              </div>
            )}
          </div>
        )}

        {event.notes && (
          <div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-2">Notes</div>
            <p className="text-xs text-terminal-muted leading-relaxed">{event.notes}</p>
          </div>
        )}

        {(event.watch_sources || event.source_url) && (
          <div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest mb-2">
              {event.source_count > 1 ? `Source · ${event.source_count} outlets covered this` : 'Source'}
            </div>
            <div className="text-xs text-terminal-text">{event.watch_sources?.name ?? '—'}</div>
            {sourceLink && (
              <a
                href={sourceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-terminal-teal hover:underline mt-1"
              >
                <ExternalLink size={10} />
                View source
              </a>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function WatchPage() {
  const [category, setCategory] = useState<WatchCategory | 'all'>('all')
  const [scopes, setScopes] = useState<string[]>([])
  const [confidence, setConfidence] = useState<string | null>(null)
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<WatchEvent | null>(null)
  const [page, setPage] = useState(0)

  // Reset page and selection on filter change
  useEffect(() => {
    setPage(0)
    setSelected(null)
  }, [category, scopes, confidence])

  const REFRESH_MS = 5 * 60 * 1000  // 5 minutes

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      let q = supabase
        .from('watch_events')
        .select('*, watch_sources(id, name, url)')
        .eq('is_duplicate', false)
        .order('event_date', { ascending: false })

      if (category !== 'all') q = q.eq('category', category)
      if (scopes.length > 0)  q = q.in('scope', scopes)
      if (confidence)         q = q.eq('confidence', confidence)

      const { data, error } = await q
      if (error) throw error
      setEvents(data ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [category, scopes, confidence])

  // Initial load (with spinner) + 5-min silent refresh
  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  const paged      = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(events.length / PAGE_SIZE)

  // Derive freshness from the most recent last_reviewed date across loaded events
  const feedMeta = useMemo((): TopBarMeta[] => {
    if (events.length === 0) return []
    const latest = events.reduce(
      (max, e) => (e.last_reviewed > max ? e.last_reviewed : max),
      events[0].last_reviewed,
    )
    return [
      { label: 'Source', value: 'Endenex Intelligence Pipeline' },
      { label: 'Updated', value: fmtDate(latest) },
      { label: 'Sync', value: 'Daily · 07:00 UTC' },
    ]
  }, [events])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Market Watch"
        subtitle="Repowering events, regulatory changes, commodity signals, and supply chain activity"
        meta={feedMeta}
      />

      {/* Filter bar */}
      <div className="border-b border-terminal-border bg-terminal-surface px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-0">
          {CATEGORIES.map(({ code, label }) => (
            <button
              key={code}
              onClick={() => setCategory(code)}
              className={clsx(
                'px-4 py-3 text-xs font-medium border-b-2 transition-colors',
                category === code
                  ? 'border-terminal-teal text-terminal-teal'
                  : 'border-transparent text-terminal-muted hover:text-terminal-text'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 py-2">
          <ScopeDropdown selected={scopes} onChange={setScopes} />
          {(['High', 'Medium', 'Low'] as const).map(c => (
            <button
              key={c}
              onClick={() => setConfidence(prev => prev === c ? null : c)}
              className={clsx(
                'px-2.5 py-1.5 text-[11px] font-mono rounded border transition-colors',
                confidence === c
                  ? `${CONFIDENCE_COLOUR[c]} border-current bg-terminal-black`
                  : 'text-terminal-muted border-terminal-border hover:text-terminal-text'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Table */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-auto">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => <SkeletonFeedRow key={i} />)
            ) : paged.length === 0 ? (
              <div className="px-6 py-12 text-center text-xs text-terminal-muted">
                No events found. The feed is updated daily from the Endenex intelligence pipeline.
              </div>
            ) : (
              paged.map(ev => {
                const style      = CATEGORY_STYLE[ev.category]
                const entity     = ev.site_name || ev.company_name || ev.developer
                const isSelected = selected?.id === ev.id
                const entityLine = [entity, ev.capacity_mw != null ? `${ev.capacity_mw} MW` : null]
                  .filter(Boolean).join(' · ')

                return (
                  <div
                    key={ev.id}
                    onClick={() => setSelected(s => s?.id === ev.id ? null : ev)}
                    className={clsx(
                      'px-6 py-5 border-b border-terminal-border cursor-pointer transition-colors',
                      isSelected
                        ? 'bg-terminal-teal/5 border-l-2 border-l-terminal-teal'
                        : 'hover:bg-terminal-surface border-l-2 border-l-transparent'
                    )}
                  >
                    {/* Meta strip */}
                    <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                      <span className="text-[11px] font-mono text-terminal-muted">
                        {fmtDate(ev.event_date)}
                      </span>
                      <span className="text-terminal-border">·</span>
                      <span className={clsx('text-[10px] font-mono px-1.5 py-0.5 rounded', style.pill)}>
                        {CATEGORY_LABEL[ev.category]}
                      </span>
                      <span className="text-[11px] text-terminal-muted">{ev.event_type}</span>
                      <span className="text-terminal-border">·</span>
                      <span className="text-[11px] font-mono text-terminal-muted">{ev.scope}</span>

                      <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                        <span className={clsx('text-[11px] font-mono', CONFIDENCE_COLOUR[ev.confidence])}>
                          {ev.confidence}
                        </span>
                        <span className="text-[11px] font-mono text-terminal-muted">
                          {ev.watch_sources?.name ?? ''}
                          {ev.source_count > 1 && (
                            <span className="text-terminal-muted/60"> +{ev.source_count - 1}</span>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Headline */}
                    <h3 className="text-[13px] font-semibold text-terminal-text leading-snug mb-2 tracking-tight">
                      {ev.headline}
                    </h3>

                    {/* Summary — wire-service style, 3 lines max */}
                    {ev.notes && (
                      <p className="text-xs text-terminal-muted leading-relaxed line-clamp-3">
                        {ev.notes}
                      </p>
                    )}

                    {/* Entity / capacity tag */}
                    {entityLine && (
                      <div className="flex items-center gap-1.5 mt-2.5">
                        <div className="w-1 h-1 rounded-full bg-terminal-border flex-shrink-0" />
                        <span className="text-[11px] font-mono text-terminal-muted">{entityLine}</span>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-terminal-border text-xs text-terminal-muted flex-shrink-0">
              <span className="font-mono">{events.length} events</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 border border-terminal-border rounded font-mono disabled:opacity-30 hover:text-terminal-text transition-colors"
                >
                  Prev
                </button>
                <span className="font-mono">{page + 1} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1.5 border border-terminal-border rounded font-mono disabled:opacity-30 hover:text-terminal-text transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel event={selected} onClose={() => setSelected(null)} />
        )}

      </div>
    </div>
  )
}
