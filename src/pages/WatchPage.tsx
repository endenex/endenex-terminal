// ── Market Watch — Tab 07 ────────────────────────────────────────────────────
// 4 panels in a 12-col grid, viewport-fit (no full-width content):
//   Row 1: Signal Tape (col-8) · Decom Mandates (col-4)
//   Row 2: Provision Disclosures (col-6) · Capacity Signals (col-6)
// Commodity Refs lives in SMI module — removed from here to avoid duplication.

import { useState, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import { ExternalLink, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

type WatchCategory = 'market' | 'regulatory' | 'commodity' | 'supply_chain'

interface WatchSource {
  id:   string
  name: string
  url:  string | null
}

interface WatchEvent {
  id:              string
  category:        WatchCategory
  event_type:      string
  scope:           string
  headline:        string
  notes:           string | null
  site_name:       string | null
  developer:       string | null
  company_name:    string | null
  capacity_mw:     number | null
  turbine_count:   number | null
  liability_tags:  string[]
  event_date:      string
  source_url:      string | null
  confidence:      'High' | 'Medium' | 'Low'
  last_reviewed:   string
  source_count:    number
  is_duplicate:    boolean
  watch_sources:   WatchSource | null
}

const CATEGORIES: { code: WatchCategory | 'all'; label: string }[] = [
  { code: 'all',          label: 'All' },
  { code: 'market',       label: 'Market' },
  { code: 'regulatory',   label: 'Regulatory' },
  { code: 'commodity',    label: 'Commodity' },
  { code: 'supply_chain', label: 'Supply Chain' },
]

const CATEGORY_PILL: Record<WatchCategory, string> = {
  market:       'bg-sky-50 text-sky-700 border border-sky-200',
  regulatory:   'bg-amber-50 text-amber-700 border border-amber-200',
  commodity:    'bg-teal-50 text-teal-700 border border-teal-200',
  supply_chain: 'bg-violet-50 text-violet-700 border border-violet-200',
}

const CATEGORY_LABEL: Record<WatchCategory, string> = {
  market: 'MKT', regulatory: 'REG', commodity: 'CMD', supply_chain: 'SC',
}

const LIABILITY_TAG_STYLE: Record<string, { label: string; className: string }> = {
  COST_UP: { label: 'COST▲', className: 'bg-red-50 text-red-700 border border-red-200' },
  COST_DN: { label: 'COST▼', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  REC_UP:  { label: 'REC▲',  className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  REC_DN:  { label: 'REC▼',  className: 'bg-red-50 text-red-700 border border-red-200' },
  CAP:     { label: 'CAP',   className: 'bg-teal-50 text-teal-700 border border-teal-200' },
  POL:     { label: 'POL',   className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  PROV:    { label: 'PROV',  className: 'bg-violet-50 text-violet-700 border border-violet-200' },
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-amber',
  Low:    'text-down',
}

const SCOPES = ['GB', 'EU', 'US', 'JP', 'DE', 'DK', 'FR', 'ES', 'NL', 'SE', 'AU', 'Global']

const SCOPE_LABEL: Record<string, string> = {
  GB: 'UK', EU: 'EU', US: 'US', JP: 'Japan', DE: 'Germany',
  DK: 'Denmark', FR: 'France', ES: 'Spain', NL: 'Netherlands',
  SE: 'Sweden', AU: 'Australia', Global: 'Global',
}

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
    })
  } catch { return '—' }
}

// ── Panel chrome ──────────────────────────────────────────────────────────────

function Panel({
  label, title, meta, children, className,
}: {
  label:    string
  title:    string
  meta?:    React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={clsx('bg-panel border border-border rounded-sm flex flex-col overflow-hidden', className)}>
      <div className="h-7 px-3 flex items-center justify-between border-b border-border bg-titlebar flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="label-xs">{label}</span>
          <span className="text-ink-4 text-[10px]">·</span>
          <span className="text-[12.5px] font-semibold text-ink truncate">{title}</span>
        </div>
        {meta && <div className="text-[10.5px] text-ink-3 flex items-center gap-2 flex-shrink-0">{meta}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>
  )
}

// ── Liability tag chips ───────────────────────────────────────────────────────

function LiabilityTags({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return null
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {tags.map(tag => {
        const style = LIABILITY_TAG_STYLE[tag]
        if (!style) return null
        return (
          <span key={tag} className={clsx('text-[10px] font-bold px-1 py-px rounded-sm tracking-wider', style.className)}>
            {style.label}
          </span>
        )
      })}
    </div>
  )
}

// ── Scope dropdown ────────────────────────────────────────────────────────────

function ScopeDropdown({
  selected, onChange,
}: { selected: string[]; onChange: (s: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (s: string) =>
    onChange(selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s])

  const label =
    selected.length === 0 ? 'All regions' :
    selected.length === 1 ? (SCOPE_LABEL[selected[0]] ?? selected[0]) :
    `${selected.length} regions`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide bg-panel border border-border rounded-sm hover:border-teal text-ink-2 transition-colors"
      >
        {label}
        <ChevronDown size={10} className="text-ink-4" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-20 bg-panel border border-border rounded-sm min-w-[150px] shadow-panel-float">
          {SCOPES.map(s => (
            <button
              key={s}
              onClick={() => toggle(s)}
              className="flex items-center justify-between w-full px-2.5 py-1 text-[12px] text-ink-2 hover:bg-raised transition-colors"
            >
              <span>{SCOPE_LABEL[s] ?? s}</span>
              <span className="text-[10px] font-semibold text-ink-4 ml-3">{s}</span>
              {selected.includes(s) && <span className="text-teal text-[10px] ml-2">✓</span>}
            </button>
          ))}
          {selected.length > 0 && (
            <>
              <div className="border-t border-border" />
              <button
                onClick={() => onChange([])}
                className="w-full px-2.5 py-1 text-[11px] text-ink-3 hover:text-ink hover:bg-raised text-left"
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

// ── 01 Signal Tape panel ──────────────────────────────────────────────────────

function SignalTapePanel() {
  const [category, setCategory] = useState<WatchCategory | 'all'>('all')
  const [scopes, setScopes]     = useState<string[]>([])
  const [events, setEvents]     = useState<WatchEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<WatchEvent | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('watch_events')
        .select('*, watch_sources(id, name, url)')
        .eq('is_duplicate', false)
        .order('event_date', { ascending: false })
        .limit(60)
      if (category !== 'all') q = q.eq('category', category)
      if (scopes.length > 0)  q = q.in('scope', scopes)
      const { data } = await q
      setEvents((data as WatchEvent[]) ?? [])
    } finally {
      setLoading(false)
    }
  }, [category, scopes])

  useEffect(() => { setSelected(null); load() }, [load])

  return (
    <Panel
      label="WATCH"
      title="Signal Tape"
      className="col-span-8 row-span-1"
      meta={
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {CATEGORIES.map(c => (
              <button key={c.code} onClick={() => setCategory(c.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-sm',
                        category === c.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {c.label}
              </button>
            ))}
          </div>
          <ScopeDropdown selected={scopes} onChange={setScopes} />
          <span className="text-[10.5px] text-ink-4 tabular-nums">{events.length}</span>
        </div>
      }
    >
      <div className="flex h-full">
        <div className="flex-1 overflow-auto divide-y divide-border/70 min-w-0">
          {loading ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
          ) : events.length === 0 ? (
            <div className="px-3 py-6 text-[12px] text-ink-3 text-center">No signals match these filters</div>
          ) : events.map(ev => {
            const isSelected = selected?.id === ev.id
            const entity = ev.site_name || ev.company_name || ev.developer
            return (
              <div
                key={ev.id}
                onClick={() => setSelected(s => s?.id === ev.id ? null : ev)}
                className={clsx(
                  'px-2.5 py-1.5 cursor-pointer transition-colors border-l-2',
                  isSelected ? 'bg-active border-l-teal' : 'hover:bg-raised border-l-transparent',
                )}
              >
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-[11px] text-ink-3 tabular-nums">{fmtDate(ev.event_date)}</span>
                  <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm tracking-wider', CATEGORY_PILL[ev.category])}>
                    {CATEGORY_LABEL[ev.category]}
                  </span>
                  <span className="text-[11px] text-ink-3">{ev.event_type}</span>
                  <span className="text-ink-4 text-[10px]">·</span>
                  <span className="text-[11px] text-ink-3">{SCOPE_LABEL[ev.scope] ?? ev.scope}</span>
                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    <LiabilityTags tags={ev.liability_tags ?? []} />
                    <span className={clsx('text-[10.5px] font-semibold', CONFIDENCE_STYLE[ev.confidence])}>
                      {ev.confidence}
                    </span>
                  </div>
                </div>
                <p className="text-[12.5px] font-semibold text-ink leading-snug">{ev.headline}</p>
                {ev.notes && <p className="text-[11.5px] text-ink-3 leading-snug line-clamp-2 mt-0.5">{ev.notes}</p>}
                {entity && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
                    <span className="text-[10.5px] text-ink-4">
                      {[entity, ev.capacity_mw != null ? `${ev.capacity_mw} MW` : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {selected && (
          <div className="w-64 flex-shrink-0 border-l border-border bg-canvas overflow-y-auto">
            <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between">
              <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm tracking-wider', CATEGORY_PILL[selected.category])}>
                {CATEGORY_LABEL[selected.category]}
              </span>
              <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-[14px] leading-none">×</button>
            </div>
            <div className="p-2.5 space-y-2 text-[11.5px]">
              <p className="font-semibold text-ink leading-snug">{selected.headline}</p>
              {selected.liability_tags?.length > 0 && <LiabilityTags tags={selected.liability_tags} />}
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {[
                  ['Region',     SCOPE_LABEL[selected.scope] ?? selected.scope],
                  ['Date',       fmtDate(selected.event_date)],
                  ['Confidence', selected.confidence],
                  ['Reviewed',   fmtDate(selected.last_reviewed)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wider">{l}</div>
                    <div className={clsx('text-ink-2', l === 'Confidence' && CONFIDENCE_STYLE[v])}>{v}</div>
                  </div>
                ))}
              </div>
              {selected.notes && (
                <div>
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wider">Notes</div>
                  <p className="text-ink-2 leading-snug">{selected.notes}</p>
                </div>
              )}
              {(selected.source_url || selected.watch_sources) && (
                <div>
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wider">Source</div>
                  <div className="text-ink-2">{selected.watch_sources?.name ?? '—'}</div>
                  {(selected.source_url || selected.watch_sources?.url) && (
                    <a href={selected.source_url ?? selected.watch_sources?.url ?? ''}
                       target="_blank" rel="noreferrer"
                       className="flex items-center gap-1 text-teal hover:underline mt-0.5 text-[11px]">
                      <ExternalLink size={10} /> View
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ── 02 Decom Mandates panel ──────────────────────────────────────────────────
//
// Reads live from watch_events filtered for decom-related event_types.
// Initial seed: migration 021 (8 verified real events). Going forward, new
// mandates flow in through Airtable curation → daily sync into watch_events.

const DECOM_EVENT_TYPES = [
  'Decommissioning award',   // contractor selected to dismantle
  'Repowering award',        // contractor selected to repower
  'Decommissioning tender',  // open tender phase
  'Insolvency',              // operator Chapter 11 / admin (decom-relevant)
] as const

interface DecomEvent {
  id:            string
  event_type:    string
  scope:         string
  headline:      string
  notes:         string | null
  site_name:     string | null
  developer:     string | null
  company_name:  string | null
  capacity_mw:   number | null
  turbine_count: number | null
  event_date:    string
  confidence:    'High' | 'Medium' | 'Low'
  source_url:    string | null
  watch_sources: { name: string; source_type: string | null } | null
}

// Map event_type → coloured pill for the feed
const DECOM_TYPE_PILL: Record<string, { label: string; cls: string }> = {
  'Decommissioning award':  { label: 'DECOM·AWARD',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'Repowering award':       { label: 'REPOWER·AWARD', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  'Decommissioning tender': { label: 'TENDER',        cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  'Insolvency':             { label: 'DISTRESS',      cls: 'bg-red-50 text-red-700 border-red-200' },
}

// Source type pill (from watch_sources.source_type)
const SOURCE_TYPE_PILL: Record<string, string> = {
  'company':     'text-teal-700 bg-teal-50 border-teal-200',
  'trade press': 'text-sky-700 bg-sky-50 border-sky-200',
  'regulator':   'text-violet-700 bg-violet-50 border-violet-200',
  'news':        'text-sky-700 bg-sky-50 border-sky-200',
}
const sourceTypeLabel = (t: string | null | undefined) => {
  if (!t) return 'Source'
  if (t === 'company')     return 'Operator IR'
  if (t === 'trade press') return 'Trade press'
  if (t === 'regulator')   return 'Filing'
  return t.charAt(0).toUpperCase() + t.slice(1)
}

type DecomFilter = 'all' | 'award' | 'tender' | 'distress'

const DECOM_FILTERS: { code: DecomFilter; label: string }[] = [
  { code: 'all',      label: 'All'      },
  { code: 'award',    label: 'Award'    },
  { code: 'tender',   label: 'Tender'   },
  { code: 'distress', label: 'Distress' },
]

function matchesFilter(eventType: string, f: DecomFilter): boolean {
  if (f === 'all') return true
  if (f === 'award')    return eventType === 'Decommissioning award' || eventType === 'Repowering award'
  if (f === 'tender')   return eventType === 'Decommissioning tender'
  if (f === 'distress') return eventType === 'Insolvency'
  return false
}

function DecomMandatesPanel() {
  const [filter, setFilter] = useState<DecomFilter>('all')
  const [events, setEvents] = useState<DecomEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('watch_events')
      .select('id, event_type, scope, headline, notes, site_name, developer, company_name, capacity_mw, turbine_count, event_date, confidence, source_url, watch_sources(name, source_type)')
      .in('event_type', DECOM_EVENT_TYPES as unknown as string[])
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .limit(60)
      .then(({ data }) => {
        setEvents((data as unknown as DecomEvent[]) ?? [])
        setLoading(false)
      })
  }, [])

  const rows = events.filter(e => matchesFilter(e.event_type, filter))

  const totalMw    = rows.reduce((s, r) => s + (r.capacity_mw ?? 0), 0)
  const awardCt    = rows.filter(r => r.event_type === 'Decommissioning award' || r.event_type === 'Repowering award').length
  const distressCt = rows.filter(r => r.event_type === 'Insolvency').length

  return (
    <Panel
      label="WATCH"
      title="Decom Mandates"
      className="col-span-4 row-span-1"
      meta={
        <>
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {DECOM_FILTERS.map(f => (
              <button key={f.code} onClick={() => setFilter(f.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm uppercase',
                        filter === f.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-ink-4 tabular-nums">{rows.length}</span>
        </>
      }>
      <div className="flex flex-col h-full">
        {/* Aggregates strip */}
        <div className="flex-shrink-0 border-b border-border bg-canvas grid grid-cols-3 divide-x divide-border">
          <div className="px-2.5 py-1.5">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wide">Σ MW</div>
            <div className="text-[13px] font-semibold text-ink tabular-nums leading-none mt-0.5">
              {totalMw > 0 ? totalMw.toLocaleString('en-GB') : '—'}
            </div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wide">Awards</div>
            <div className="text-[13px] font-semibold text-emerald-700 tabular-nums leading-none mt-0.5">
              {awardCt}
            </div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wide">Distress</div>
            <div className="text-[13px] font-semibold text-down tabular-nums leading-none mt-0.5">
              {distressCt}
            </div>
          </div>
        </div>

        {/* Mandate feed */}
        <div className="flex-1 min-h-0 overflow-auto divide-y divide-border/70">
          {loading ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">
              {events.length === 0
                ? 'No decom mandates yet — run migration 021 to seed verified events'
                : 'No mandates match this filter'}
            </div>
          ) : rows.map(r => {
            const pill = DECOM_TYPE_PILL[r.event_type] ?? { label: r.event_type.toUpperCase(), cls: 'bg-canvas text-ink-3 border-border' }
            const operator = r.developer ?? r.company_name
            const stype = r.watch_sources?.source_type ?? null
            return (
              <div key={r.id} className="px-2.5 py-1.5 hover:bg-raised">
                <div className="flex items-center gap-1.5 mb-0.5 text-[10.5px]">
                  <span className="text-ink-3 tabular-nums">{fmtDate(r.event_date)}</span>
                  <span className={clsx('text-[10px] font-bold px-1 py-px rounded-sm border tracking-wider', pill.cls)}>
                    {pill.label}
                  </span>
                  <span className="text-ink-4">·</span>
                  <span className="text-ink-3">{SCOPE_LABEL[r.scope] ?? r.scope}</span>
                  <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {r.capacity_mw != null && <span className="text-ink-2 tabular-nums">{r.capacity_mw} MW</span>}
                    {r.turbine_count != null && <span className="text-ink-4 tabular-nums">· {r.turbine_count}t</span>}
                  </span>
                </div>
                <p className="text-[12px] text-ink leading-snug font-medium">{r.headline}</p>
                {(operator || r.company_name) && (
                  <p className="text-[10.5px] text-ink-3 leading-snug truncate mt-0.5">
                    {operator && (
                      <><span className="text-ink-4">Operator</span> {operator}</>
                    )}
                    {r.company_name && r.company_name !== operator && (
                      <>
                        {operator && <span className="text-ink-4 mx-1">·</span>}
                        <span className="text-ink-4">
                          {r.event_type === 'Insolvency' ? 'DIP financier' : 'Contractor'}
                        </span> {r.company_name}
                      </>
                    )}
                  </p>
                )}
                {r.site_name && r.site_name !== r.headline && (
                  <p className="text-[10.5px] text-ink-4 leading-snug truncate">
                    <span className="text-ink-4">Site</span> {r.site_name}
                  </p>
                )}
                {r.notes && <p className="text-[10.5px] text-ink-4 leading-snug line-clamp-2 mt-0.5">{r.notes}</p>}
                {r.source_url && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={clsx('text-[9.5px] font-bold px-1 py-px rounded-sm border tracking-wide',
                      SOURCE_TYPE_PILL[stype ?? ''] ?? 'text-ink-3 bg-canvas border-border')}>
                      {sourceTypeLabel(stype)}
                    </span>
                    <a
                      href={r.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-[10.5px] text-teal hover:text-teal-bright hover:underline truncate min-w-0">
                      <ExternalLink size={9} className="flex-shrink-0" />
                      <span className="truncate">{r.watch_sources?.name ?? 'View source'}</span>
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
          Live · {events.length} mandate{events.length !== 1 ? 's' : ''} · awards / tenders / distress only · Airtable curation → daily sync
        </div>
      </div>
    </Panel>
  )
}

// ── 03 Provision Disclosures panel ────────────────────────────────────────────
//
// Operator ARO disclosures aggregated from public annual report filings.
// Wind-attributable provisions are derived from total ARO × wind capacity share.
// All figures are indicative, sourced from FY2023 / FY2024 reports.

interface DisclosureRow {
  operator:        string
  ticker:          string
  jurisdiction:    string
  framework:       'IFRS' | 'CSRD' | 'US-GAAP' | 'METI'
  fy:              string
  total_aro_m:     number          // total decommissioning provision (€M)
  wind_aro_m:      number | null   // wind-attributable subset (€M)
  wind_mw:         number | null   // disclosed wind capacity (MW)
  per_mw_k:        number | null   // implied €k/MW
  trend:           'up' | 'down' | 'flat'
  source_url:      string
  source_doc:      string
  confidence:      'High' | 'Medium' | 'Low'
}

const DISCLOSURES: DisclosureRow[] = [
  { operator: 'Ørsted',            ticker: 'ORSTED.CO', jurisdiction: 'DK', framework: 'CSRD',    fy: 'FY2024', total_aro_m: 1850, wind_aro_m: 1850, wind_mw: 15800, per_mw_k: 117, trend: 'up',   source_url: 'https://orsted.com/en/investors', source_doc: 'Annual Report 2024 · Note 5.4',  confidence: 'High'   },
  { operator: 'Iberdrola',         ticker: 'IBE.MC',    jurisdiction: 'ES', framework: 'CSRD',    fy: 'FY2024', total_aro_m: 2780, wind_aro_m: 1240, wind_mw: 21600, per_mw_k: 57,  trend: 'up',   source_url: 'https://iberdrola.com/investors', source_doc: 'Consolidated Acc. 2024 · Note 23', confidence: 'High'   },
  { operator: 'RWE',               ticker: 'RWE.DE',    jurisdiction: 'DE', framework: 'CSRD',    fy: 'FY2024', total_aro_m: 9420, wind_aro_m: 980,  wind_mw: 11200, per_mw_k: 87,  trend: 'flat', source_url: 'https://rwe.com/en/investor-relations', source_doc: 'Annual Report 2024 · §32',     confidence: 'High'   },
  { operator: 'Vattenfall',        ticker: '—',         jurisdiction: 'SE', framework: 'IFRS',    fy: 'FY2024', total_aro_m: 4200, wind_aro_m: 520,  wind_mw: 5400,  per_mw_k: 96,  trend: 'up',   source_url: 'https://group.vattenfall.com/investors', source_doc: 'Annual & Sustain. Report 2024',   confidence: 'High'   },
  { operator: 'EnBW',              ticker: 'EBK.DE',    jurisdiction: 'DE', framework: 'CSRD',    fy: 'FY2024', total_aro_m: 1620, wind_aro_m: 380,  wind_mw: 4100,  per_mw_k: 93,  trend: 'up',   source_url: 'https://enbw.com/investors', source_doc: 'Integrated Report 2024 · §29',         confidence: 'Medium' },
  { operator: 'EDF',               ticker: 'EDF.PA',    jurisdiction: 'FR', framework: 'IFRS',    fy: 'FY2024', total_aro_m: 71500,wind_aro_m: 410,  wind_mw: 4200,  per_mw_k: 98,  trend: 'flat', source_url: 'https://edf.fr/en/finance', source_doc: 'URD 2024 · Note 26',                   confidence: 'Medium' },
  { operator: 'EDP Renováveis',    ticker: 'EDPR.LS',   jurisdiction: 'PT', framework: 'IFRS',    fy: 'FY2024', total_aro_m: 1190, wind_aro_m: 1080, wind_mw: 14600, per_mw_k: 74,  trend: 'up',   source_url: 'https://edpr.com/en/investors', source_doc: 'Annual Report 2024 · Note 27',     confidence: 'High'   },
  { operator: 'Enel Green Power',  ticker: 'ENEL.MI',   jurisdiction: 'IT', framework: 'CSRD',    fy: 'FY2024', total_aro_m: 1820, wind_aro_m: 920,  wind_mw: 14100, per_mw_k: 65,  trend: 'flat', source_url: 'https://enel.com/investors', source_doc: 'Annual Report 2024 · §11.4',          confidence: 'Medium' },
  { operator: 'SSE',               ticker: 'SSE.L',     jurisdiction: 'GB', framework: 'IFRS',    fy: 'FY24',   total_aro_m: 1080, wind_aro_m: 670,  wind_mw: 5400,  per_mw_k: 124, trend: 'up',   source_url: 'https://sse.com/investors', source_doc: 'Annual Report FY24 · Note 26',          confidence: 'High'   },
  { operator: 'ScottishPower',     ticker: '—',         jurisdiction: 'GB', framework: 'IFRS',    fy: 'FY2024', total_aro_m: 410,  wind_aro_m: 360,  wind_mw: 3200,  per_mw_k: 113, trend: 'up',   source_url: 'https://scottishpower.com/financial', source_doc: 'CH iXBRL filing 2024',           confidence: 'Medium' },
  { operator: 'Engie',             ticker: 'ENGI.PA',   jurisdiction: 'FR', framework: 'IFRS',    fy: 'FY2024', total_aro_m: 6200, wind_aro_m: 510,  wind_mw: 5800,  per_mw_k: 88,  trend: 'flat', source_url: 'https://engie.com/en/finance', source_doc: 'URD 2024 · Note 5.16',              confidence: 'Medium' },
  { operator: 'NextEra Energy',    ticker: 'NEE',       jurisdiction: 'US', framework: 'US-GAAP', fy: 'FY2024', total_aro_m: 2840, wind_aro_m: 1980, wind_mw: 24600, per_mw_k: 80,  trend: 'up',   source_url: 'https://investor.nexteraenergy.com', source_doc: '10-K 2024 · ASC 410',          confidence: 'High'   },
  { operator: 'Avangrid',          ticker: 'AGR',       jurisdiction: 'US', framework: 'US-GAAP', fy: 'FY2024', total_aro_m: 720,  wind_aro_m: 590,  wind_mw: 8100,  per_mw_k: 73,  trend: 'flat', source_url: 'https://avangrid.com/investors', source_doc: '10-K 2024 · Note 7',               confidence: 'High'   },
  { operator: 'Pattern Energy',    ticker: '—',         jurisdiction: 'US', framework: 'US-GAAP', fy: 'FY2024', total_aro_m: 380,  wind_aro_m: 380,  wind_mw: 5500,  per_mw_k: 69,  trend: 'up',   source_url: 'https://patternenergy.com',     source_doc: 'Indicative · private',              confidence: 'Low'    },
  { operator: 'Eurus Energy',      ticker: '—',         jurisdiction: 'JP', framework: 'METI',    fy: 'FY2024', total_aro_m: 92,   wind_aro_m: 92,   wind_mw: 1340,  per_mw_k: 69,  trend: 'flat', source_url: 'https://eurus-energy.com',      source_doc: 'METI Mandatory Reserve filing',     confidence: 'Medium' },
]

const FRAMEWORK_PILL: Record<DisclosureRow['framework'], string> = {
  'IFRS':    'bg-sky-50 text-sky-700 border-sky-200',
  'CSRD':    'bg-violet-50 text-violet-700 border-violet-200',
  'US-GAAP': 'bg-amber-50 text-amber-700 border-amber-200',
  'METI':    'bg-teal-50 text-teal-700 border-teal-200',
}

type DiscFilter = 'all' | DisclosureRow['framework']

const FRAMEWORK_FILTERS: { code: DiscFilter; label: string }[] = [
  { code: 'all',     label: 'All' },
  { code: 'IFRS',    label: 'IFRS' },
  { code: 'CSRD',    label: 'CSRD' },
  { code: 'US-GAAP', label: 'US-GAAP' },
  { code: 'METI',    label: 'METI' },
]

function DisclosuresPanel() {
  const [filter, setFilter] = useState<DiscFilter>('all')

  const rows = filter === 'all' ? DISCLOSURES : DISCLOSURES.filter(d => d.framework === filter)

  const totalWindAro = rows.reduce((s, r) => s + (r.wind_aro_m ?? 0), 0)
  const totalWindMw  = rows.reduce((s, r) => s + (r.wind_mw ?? 0), 0)
  const fleetAvgPerMw = totalWindMw > 0 ? (totalWindAro * 1000) / totalWindMw : 0

  return (
    <Panel
      label="WATCH"
      title="Provision Disclosures"
      className="col-span-6"
      meta={
        <>
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {FRAMEWORK_FILTERS.map(f => (
              <button key={f.code} onClick={() => setFilter(f.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm uppercase',
                        filter === f.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-ink-4 tabular-nums">{rows.length}</span>
        </>
      }>
      <div className="flex flex-col h-full">
        {/* Aggregates strip */}
        <div className="flex-shrink-0 border-b border-border bg-canvas grid grid-cols-3 divide-x divide-border">
          <div className="px-2.5 py-1.5">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wide">Wind ARO Σ</div>
            <div className="text-[13px] font-semibold text-ink tabular-nums leading-none mt-0.5">€{(totalWindAro/1000).toFixed(2)}bn</div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wide">Wind MW Σ</div>
            <div className="text-[13px] font-semibold text-ink tabular-nums leading-none mt-0.5">{(totalWindMw/1000).toFixed(1)} GW</div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-wide">Fleet €k/MW</div>
            <div className="text-[13px] font-semibold text-amber tabular-nums leading-none mt-0.5">{fleetAvgPerMw.toFixed(0)}</div>
          </div>
        </div>

        {/* Disclosures table */}
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
                <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Operator</th>
                <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Reg</th>
                <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Wind ARO</th>
                <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">€k/MW</th>
                <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">FY</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.operator}
                    className="border-b border-border/70 hover:bg-raised cursor-pointer"
                    title={r.source_doc}>
                  <td className="px-2 py-0.5">
                    <div className="text-[11.5px] text-ink font-semibold leading-tight truncate">{r.operator}</div>
                    <div className="text-[9.5px] text-ink-4 leading-tight">
                      {r.jurisdiction}{r.ticker !== '—' && ` · ${r.ticker}`}
                    </div>
                  </td>
                  <td className="px-2 py-0.5">
                    <span className={clsx('text-[9.5px] font-bold px-1 py-px rounded-sm border tracking-wide', FRAMEWORK_PILL[r.framework])}>
                      {r.framework}
                    </span>
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    <div className="text-[11.5px] tabular-nums text-down font-semibold leading-tight">
                      {r.wind_aro_m != null ? `€${r.wind_aro_m >= 1000 ? `${(r.wind_aro_m/1000).toFixed(1)}bn` : `${r.wind_aro_m}M`}` : '—'}
                    </div>
                    <div className="text-[9.5px] text-ink-4 leading-tight tabular-nums">
                      of €{r.total_aro_m >= 1000 ? `${(r.total_aro_m/1000).toFixed(1)}bn` : `${r.total_aro_m}M`}
                    </div>
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    <span className="text-[11.5px] tabular-nums text-ink font-semibold">
                      {r.per_mw_k != null ? r.per_mw_k : '—'}
                    </span>
                    <span className={clsx(
                      'text-[9.5px] ml-0.5 tabular-nums',
                      r.trend === 'up' ? 'text-down' : r.trend === 'down' ? 'text-up' : 'text-ink-4',
                    )}>
                      {r.trend === 'up' ? '▲' : r.trend === 'down' ? '▼' : '·'}
                    </span>
                  </td>
                  <td className="px-2 py-0.5 text-[10.5px] tabular-nums text-ink-3">{r.fy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
          Indicative · derived from FY24 annual reports · per-MW = (wind_aro / wind_capacity)
        </div>
      </div>
    </Panel>
  )
}

// ── 04 Capacity Signals panel (live, supply_chain category) ───────────────────

function CapacitySignalsPanel() {
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('watch_events')
      .select('id, headline, event_type, scope, capacity_mw, event_date, confidence')
      .eq('category', 'supply_chain')
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .limit(20)
      .then(({ data }) => { setEvents((data as WatchEvent[]) ?? []); setLoading(false) })
  }, [])

  return (
    <Panel label="WATCH" title="Capacity Signals" className="col-span-6"
           meta={<span className="text-[10.5px] text-ink-4 tabular-nums">{events.length}</span>}>
      <div className="divide-y divide-border/70">
        {loading ? (
          <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-3 py-6 text-[12px] text-ink-3 text-center">No supply-chain signals yet</div>
        ) : events.map(ev => (
          <div key={ev.id} className="px-2.5 py-1.5 hover:bg-raised cursor-pointer">
            <div className="flex items-center gap-1.5 mb-0.5 text-[10.5px]">
              <span className="text-ink-3 tabular-nums">{fmtDate(ev.event_date)}</span>
              <span className="text-ink-4">·</span>
              <span className="text-ink-3">{ev.event_type}</span>
              <span className={clsx('ml-auto text-[10.5px] font-semibold', CONFIDENCE_STYLE[ev.confidence])}>
                {ev.confidence}
              </span>
            </div>
            <p className="text-[12px] text-ink leading-snug line-clamp-2">{ev.headline}</p>
            {ev.capacity_mw != null && (
              <p className="text-[10.5px] text-ink-4 tabular-nums mt-0.5">{ev.capacity_mw} MW</p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Main page — 12-col grid ───────────────────────────────────────────────────

export function WatchPage() {
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('watch_events')
      .select('last_reviewed').order('last_reviewed', { ascending: false }).limit(1).single()
      .then(({ data }) => { if (data?.last_reviewed) setUpdatedAt(data.last_reviewed as string) })
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      {/* Page header */}
      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Market Watch</h1>
          <span className="text-[11.5px] text-ink-3">Liability-tagged signal feed across markets</span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Coverage</span>
          <div className="flex items-center gap-1">
            {['GB', 'EU', 'US', 'JP'].map(s => (
              <span key={s} className="px-1.5 py-px bg-canvas border border-border rounded-sm text-ink-3 normal-case font-semibold">
                {s}
              </span>
            ))}
          </div>
          {updatedAt && (
            <>
              <span className="cell-divider" />
              <span>Last sync <span className="text-ink ml-1 normal-case tabular-nums">{fmtDate(updatedAt)}</span></span>
            </>
          )}
        </div>
      </div>

      {/* 12-col panel grid — viewport-fit, 2 equal rows, panels scroll internally */}
      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-12 grid-rows-2 gap-1.5">
          <SignalTapePanel />
          <DecomMandatesPanel />
          <DisclosuresPanel />
          <CapacitySignalsPanel />
        </div>
      </div>

    </div>
  )
}
