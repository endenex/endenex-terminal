// ── Market Watch — Tab 07 ────────────────────────────────────────────────────
// 4 panels in a 12-col grid, viewport-fit (no full-width content):
//   Row 1: Signal Tape (col-8) · Decom Mandates (col-4)
//   Row 2: Provisions (col-6) · Bond/Guarantee Disclosures (col-6)
//
// ARO disclosures split into TWO panels by disclosure style (per discussion):
//   Provisions  — pure-play operators publishing IAS 37 / ASC 410 / CSRD provision figures
//   Bonds       — investment-entity YieldCos publishing per-site decom guarantees
// Strict asset_class taxonomy (onshore_wind / offshore_wind / solar_pv / bess) — never mixed.
//
// Removed from this module:
//   Commodity Refs   — duplicated SMI module
//   Capacity Signals — duplicated Signal Tape (supply_chain category surfaces there)

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

// Directional liability tags. Up/down reflects the implied direction of the
// underlying balance: provisions recognised vs released, recovery economics
// improving vs deteriorating.
//
// CAP_UP / CAP_DN deliberately omitted: capacity-direction tags weren't
// adding analytical value over the row's existing event_type — every
// "Decommissioning" row is by definition CAP-down; tagging it again was
// redundant. Provision and recovery direction remain because they carry
// information not already in the event_type.
const LIABILITY_TAG_STYLE: Record<string, { label: string; className: string }> = {
  COST_UP:  { label: 'COST▲', className: 'bg-red-50 text-red-700 border border-red-200' },
  COST_DN:  { label: 'COST▼', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  PROV_UP:  { label: 'PROV▲', className: 'bg-violet-100 text-violet-800 border border-violet-300' },
  PROV_DN:  { label: 'PROV▼', className: 'bg-violet-50 text-violet-700 border border-violet-200' },
  REC_UP:   { label: 'REC▲',  className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  REC_DN:   { label: 'REC▼',  className: 'bg-red-50 text-red-700 border border-red-200' },
  POL:      { label: 'POL',   className: 'bg-amber-50 text-amber-700 border border-amber-200' },
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
// Reads from aro_provisions — pure-play single-asset-class operators that
// publish a consolidated ARO provision under IAS 37 / ASC 410 / CSRD.
// Strict asset_class filtering keeps onshore wind, offshore wind, solar PV
// and BESS separate (per-MW figures cannot be mixed across these).

interface AroProvisionRow {
  id:                string
  operator:          string
  ticker:            string | null
  jurisdiction:      string
  asset_class:       'onshore_wind' | 'offshore_wind' | 'solar_pv' | 'bess'
  framework:         'IFRS' | 'CSRD' | 'US-GAAP' | 'METI'
  fy:                string
  total_aro_m:       number
  currency:          string
  capacity_mw:       number | null
  per_mw_k:          number | null
  attribution:       'disclosed' | 'derived'
  attribution_notes: string | null
  source_name:       string
  source_url:        string
  filing_page:       number | null
  notes:             string | null
}

const FRAMEWORK_PILL: Record<AroProvisionRow['framework'], string> = {
  'IFRS':    'bg-sky-50 text-sky-700 border-sky-200',
  'CSRD':    'bg-violet-50 text-violet-700 border-violet-200',
  'US-GAAP': 'bg-amber-50 text-amber-700 border-amber-200',
  'METI':    'bg-teal-50 text-teal-700 border-teal-200',
}

type AssetClassFilter = 'all' | 'onshore_wind' | 'offshore_wind' | 'solar_pv' | 'bess'

const ASSET_CLASS_FILTERS: { code: AssetClassFilter; label: string }[] = [
  { code: 'all',           label: 'All'      },
  { code: 'onshore_wind',  label: 'On-Wind'  },
  { code: 'offshore_wind', label: 'Off-Wind' },
  { code: 'solar_pv',      label: 'Solar'    },
  { code: 'bess',          label: 'BESS'     },
]

const ASSET_CLASS_LABEL_SHORT: Record<AroProvisionRow['asset_class'], string> = {
  'onshore_wind':  'On-Wind',
  'offshore_wind': 'Off-Wind',
  'solar_pv':      'Solar',
  'bess':          'BESS',
}

const CCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', DKK: 'kr', JPY: '¥', AUD: 'A$' }

function ProvisionsPanel() {
  const [filter, setFilter]   = useState<AssetClassFilter>('all')
  const [rows, setRows]       = useState<AroProvisionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase.from('aro_provisions').select('*').order('total_aro_m', { ascending: false })
      .then(({ data }) => {
        setRows((data as AroProvisionRow[]) ?? [])
        setLoading(false)
      })
  }, [])

  const filtered = filter === 'all' ? rows : rows.filter(r => r.asset_class === filter)

  return (
    <Panel
      label="WATCH"
      title="Provision Disclosures"
      className="col-span-6"
      meta={
        <>
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {ASSET_CLASS_FILTERS.map(f => (
              <button key={f.code} onClick={() => setFilter(f.code)}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm uppercase',
                        filter === f.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-ink-4 tabular-nums">{filtered.length}</span>
        </>
      }>
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-[11.5px] text-ink-3 text-center leading-snug">
              No verified provision-style disclosures yet.<br />
              <span className="text-ink-4">Pure-play operators (Ørsted offshore-wind, EDPR, etc.) pending ingestion via Airtable curation.</span>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
                  <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Operator</th>
                  <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">Class</th>
                  <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">ARO</th>
                  <th className="px-2 py-1 text-right text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">k/MW</th>
                  <th className="px-2 py-1 text-left text-[9.5px] font-semibold text-ink-3 uppercase tracking-wide">FY</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const sym = CCY_SYMBOL[r.currency] ?? r.currency
                  return (
                    <tr key={r.id} className="border-b border-border/70 hover:bg-raised">
                      <td className="px-2 py-0.5">
                        <div className="text-[11.5px] text-ink font-semibold leading-tight truncate">{r.operator}</div>
                        <div className="text-[9.5px] text-ink-4 leading-tight">
                          {r.jurisdiction}{r.ticker && ` · ${r.ticker}`} · <span className={clsx('font-bold', FRAMEWORK_PILL[r.framework].split(' ')[1])}>{r.framework}</span>
                        </div>
                      </td>
                      <td className="px-2 py-0.5">
                        <span className="text-[10px] font-bold px-1 py-px rounded-sm border tracking-wide bg-canvas text-ink-2 border-border">
                          {ASSET_CLASS_LABEL_SHORT[r.asset_class]}
                        </span>
                      </td>
                      <td className="px-2 py-0.5 text-right">
                        {r.total_aro_m === 0 ? (
                          <>
                            <div className="text-[10.5px] uppercase tracking-wide text-amber-700 font-bold leading-tight" title={r.attribution_notes ?? ''}>
                              No ARO
                            </div>
                            <div className="text-[9px] text-ink-4 leading-tight">recognised</div>
                          </>
                        ) : (
                          <>
                            <div className="text-[11.5px] tabular-nums text-down font-semibold leading-tight">
                              {sym}{r.total_aro_m >= 1000 ? `${(r.total_aro_m/1000).toFixed(1)}bn` : `${r.total_aro_m}M`}
                            </div>
                            <div className="text-[9px] text-ink-4 leading-tight">
                              {r.attribution === 'disclosed' ? 'DISC' : 'DRV'}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink">
                        {r.total_aro_m === 0 ? <span className="text-ink-4">—</span> :
                         r.per_mw_k != null ? r.per_mw_k.toFixed(0) : '—'}
                      </td>
                      <td className="px-2 py-0.5">
                        <a href={r.source_url + (r.filing_page ? `#page=${r.filing_page}` : '')}
                           target="_blank" rel="noopener noreferrer"
                           onClick={e => e.stopPropagation()}
                           className="flex items-center gap-1 text-[10.5px] text-teal hover:text-teal-bright hover:underline">
                          {r.fy} <ExternalLink size={9} />
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
          Pure-play operators only · IAS 37 / ASC 410 / CSRD provisions · onshore vs offshore never mixed
        </div>
      </div>
    </Panel>
  )
}

// ── 04 Bond / Guarantee Disclosures panel ───────────────────────────────────
//
// Reads from aro_bonds — site-level decommissioning bonds and counter-indemnities
// posted by investment-entity YieldCos (Greencoat UK Wind, NextEnergy Solar
// Fund, Bluefield, Foresight, Gore Street). Click an operator row to expand
// the per-site breakdown.

interface AroBondRow {
  id:                    string
  operator:              string
  operator_ticker:       string | null
  jurisdiction:          string
  fy:                    string
  site_name:             string
  site_asset_class:      'onshore_wind' | 'offshore_wind' | 'solar_pv' | 'bess'
  site_country:          string | null
  site_capacity_mw:      number | null
  ownership_pct:         number | null
  beneficiary:           string
  beneficiary_type:      string | null
  bond_currency:         string
  bond_amount_thousands: number
  bond_instrument:       string | null
  purpose_pure_decom:    boolean
  purpose_notes:         string | null
  source_name:           string
  source_url:            string
  filing_page:           number | null
}

interface BondOperatorAgg {
  operator:        string
  operator_ticker: string | null
  jurisdiction:    string
  fy:              string
  asset_classes:   Set<AroBondRow['site_asset_class']>
  total_thousands: number
  pure_decom_thousands: number
  currency:        string
  site_count:      number
  rows:            AroBondRow[]
}

// ── BLM US Federal Lands (multi-asset) data shapes ───────────────────────────
// Sourced from blm_renewable_sites_summary_v + blm_renewable_sites_v (curated
// list of well-known BLM-permitted wind/solar/BESS sites). Conceptually
// different from operator-posted aro_bonds: regulator-implied statutory
// minimum vs DCI-derived economic liability.

type BlmAssetClass = 'onshore_wind' | 'solar_pv' | 'bess'

interface BlmAssetClassSummary {
  asset_class:                       BlmAssetClass
  site_count:                        number
  total_turbines:                    number | null
  total_capacity_mw:                 number
  sum_statutory_min_bond_usd:        number | null
}

interface BlmSiteRow {
  blm_serial:                  string
  project_name:                string
  operator:                    string | null
  asset_class:                 BlmAssetClass
  state:                       string
  capacity_mw:                 number
  turbine_count:               number | null
  commissioning_year:          number | null
  citation_source:             string
  citation_url:                string | null
  notes:                       string | null
  statutory_min_bond_usd:      number | null
  statutory_basis:             string | null
}

// Companies House iXBRL extraction (migration 026)
interface ChDecomProvisionRow {
  company_number: string
  company_name:   string
  parent_group:   string | null
  asset_class:    string | null
  capacity_mw:    number | null
  period_end:     string
  value_gbp:      number
  concept_name:   string
  concept_label:  string | null
  taxonomy:       string | null
  date_filed:     string | null
  document_url:   string | null
}

function BondsPanel() {
  const [filter, setFilter]   = useState<AssetClassFilter>('all')
  const [bonds, setBonds]     = useState<AroBondRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [blmSummaries, setBlmSummaries] = useState<BlmAssetClassSummary[]>([])
  const [blmSites,     setBlmSites]     = useState<BlmSiteRow[]>([])
  const [chProvisions, setChProvisions] = useState<ChDecomProvisionRow[]>([])

  useEffect(() => {
    setLoading(true)
    let alive = true

    // aro_bonds — always required
    ;(async () => {
      try {
        const { data, error } = await supabase.from('aro_bonds').select('*')
          .order('operator', { ascending: true })
          .order('bond_amount_thousands', { ascending: false })
        if (!alive) return
        if (error) console.warn('aro_bonds query failed:', error.message)
        setBonds((data as AroBondRow[]) ?? [])
      } catch (e) {
        console.error('aro_bonds query threw:', e)
      } finally {
        if (alive) setLoading(false)
      }
    })()

    // BLM Federal Lands per-asset-class summary (migration 025)
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('blm_renewable_sites_summary_v').select('*')
        if (!alive) return
        if (error) console.info('blm_renewable_sites_summary_v not available (run migration 025):', error.message)
        setBlmSummaries((data as unknown as BlmAssetClassSummary[]) ?? [])
      } catch (e) {
        console.info('BLM summaries skipped:', e)
      }
    })()

    // BLM Federal Lands per-site detail (migration 025)
    ;(async () => {
      try {
        const { data, error } = await supabase.from('blm_renewable_sites_v').select('*')
          .order('statutory_min_bond_usd', { ascending: false })
        if (!alive) return
        if (error) console.info('blm_renewable_sites_v not available:', error.message)
        setBlmSites((data as unknown as BlmSiteRow[]) ?? [])
      } catch (e) {
        console.info('BLM sites skipped:', e)
      }
    })()

    // Companies House iXBRL — latest decom-flavoured provision per company (migration 026)
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('ch_latest_decom_provision_v').select('*')
          .order('value_gbp', { ascending: false, nullsFirst: false })
        if (!alive) return
        if (error) console.info('ch_latest_decom_provision_v not available (run migration 026):', error.message)
        setChProvisions((data as unknown as ChDecomProvisionRow[]) ?? [])
      } catch (e) {
        console.info('CH provisions skipped:', e)
      }
    })()

    return () => { alive = false }
  }, [])

  // Apply asset-class filter at the row level
  const filteredBonds = filter === 'all'
    ? bonds
    : bonds.filter(b => b.site_asset_class === filter)

  // Aggregate by operator (counts UNIQUE site_names, not bond rows)
  const operators: BondOperatorAgg[] = (() => {
    const map = new Map<string, BondOperatorAgg>()
    for (const b of filteredBonds) {
      const key = `${b.operator}|${b.fy}`
      let agg = map.get(key)
      if (!agg) {
        agg = {
          operator: b.operator, operator_ticker: b.operator_ticker,
          jurisdiction: b.jurisdiction, fy: b.fy,
          asset_classes: new Set(), total_thousands: 0, pure_decom_thousands: 0,
          currency: b.bond_currency, site_count: 0, rows: [],
        }
        map.set(key, agg)
      }
      agg.asset_classes.add(b.site_asset_class)
      agg.total_thousands += b.bond_amount_thousands
      if (b.purpose_pure_decom) agg.pure_decom_thousands += b.bond_amount_thousands
      agg.rows.push(b)
    }
    // Compute unique site count across all rows
    for (const agg of map.values()) {
      agg.site_count = new Set(agg.rows.map(r => `${r.site_name}|${r.site_asset_class}`)).size
    }
    return Array.from(map.values()).sort((a, b) => b.total_thousands - a.total_thousands)
  })()

  const formatBond = (k: number, sym: string) => {
    if (k >= 1000) return `${sym}${(k / 1000).toFixed(1)}m`
    return `${sym}${k.toFixed(0)}k`
  }

  return (
    <Panel
      label="WATCH"
      title="Bond / Guarantee Disclosures"
      className="col-span-6"
      meta={
        <>
          <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
            {ASSET_CLASS_FILTERS.map(f => (
              <button key={f.code} onClick={() => { setFilter(f.code); setExpanded(null) }}
                      className={clsx(
                        'px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm uppercase',
                        filter === f.code ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                      )}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-[10.5px] text-ink-4 tabular-nums">{operators.length}</span>
        </>
      }>
      {(() => {
        // BLM Federal Lands — show whenever filter is 'all' or matches an
        // asset class we have data for. Offshore wind is excluded entirely
        // (offshore is BOEM jurisdiction, not BLM).
        const visibleSummaries = blmSummaries.filter(s =>
          filter === 'all' || filter === s.asset_class
        )
        const visibleSites = blmSites.filter(s =>
          filter === 'all' || filter === s.asset_class
        )

        const fedSiteCount  = visibleSummaries.reduce((a, s) => a + Number(s.site_count ?? 0), 0)
        const fedCapacityMw = visibleSummaries.reduce((a, s) => a + Number(s.total_capacity_mw ?? 0), 0)
        const fedStatutory  = visibleSummaries.reduce((a, s) => a + Number(s.sum_statutory_min_bond_usd ?? 0), 0)

        const showFederal   = fedSiteCount > 0 && filter !== 'offshore_wind'
        const federalKey    = '__BLM_US_FEDERAL_LANDS__'
        const isFederalOpen = expanded === federalKey

        const fmtUsd = (v: number | null | undefined): string => {
          const n = Number(v ?? 0)
          if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}bn`
          if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}m`
          if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}k`
          return `$${n.toFixed(0)}`
        }

        const ASSET_CLASS_PILL_FED: Record<BlmAssetClass, string> = {
          onshore_wind: 'bg-teal-50 text-teal-700 border-teal-200',
          solar_pv:     'bg-amber-50 text-amber-700 border-amber-200',
          bess:         'bg-violet-50 text-violet-700 border-violet-200',
        }
        const CLASS_LABEL: Record<BlmAssetClass, string> = {
          onshore_wind: 'On-Wind',
          solar_pv:     'Solar',
          bess:         'BESS',
        }
        const CLASS_ORDER: BlmAssetClass[] = ['onshore_wind', 'solar_pv', 'bess']
        const visibleClasses = CLASS_ORDER.filter(c => visibleSummaries.some(s => s.asset_class === c))

        // ── Companies House iXBRL: filter by asset_class ─────────────────────
        const chFiltered = chProvisions.filter(c =>
          filter === 'all' || (c.asset_class && filter === c.asset_class)
        )
        const chTotalGbp = chFiltered.reduce((a, c) => a + Number(c.value_gbp ?? 0), 0)
        const chCompanyCount = new Set(chFiltered.map(c => c.company_number)).size
        const showCh = chFiltered.length > 0
        const chKey = '__CH_IXBRL__'
        const isChOpen = expanded === chKey
        const fmtGbp = (n: number | null | undefined) => {
          if (n == null) return '£—'
          if (n >= 1_000_000_000) return `£${(n / 1_000_000_000).toFixed(2)}bn`
          if (n >= 1_000_000)     return `£${(n / 1_000_000).toFixed(1)}m`
          if (n >= 1_000)         return `£${(n / 1_000).toFixed(0)}k`
          return `£${n.toFixed(0)}`
        }

        return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <div className="px-3 py-4 text-[12px] text-ink-3 text-center">Loading…</div>
          ) : (operators.length === 0 && !showFederal && !showCh) ? (
            <div className="px-3 py-6 text-[11.5px] text-ink-3 text-center leading-snug">
              No bond disclosures match this filter.<br />
              <span className="text-ink-4">Pure-play YieldCos (Greencoat UKW, NextEnergy Solar, Gore Street BESS, etc.) curated via Airtable.</span>
            </div>
          ) : (
            <div className="divide-y divide-border/70">

              {/* ── BLM Federal Lands · regulator-implied (always at top when shown) ── */}
              {showFederal && (
                <div>
                  <button
                    onClick={() => setExpanded(isFederalOpen ? null : federalKey)}
                    className="w-full px-2.5 py-1.5 text-left hover:bg-raised flex items-center gap-2 bg-amber-50/40">
                    <span className="text-ink-4 text-[10px] tabular-nums w-3">{isFederalOpen ? '▼' : '▶'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] font-semibold text-ink truncate flex items-center gap-1.5">
                        BLM US Federal Lands
                        <span className="text-[9px] font-bold px-1 py-px rounded-sm border tracking-wide bg-amber-50 text-amber-700 border-amber-200">
                          REGULATOR-IMPLIED
                        </span>
                      </div>
                      <div className="text-[10px] text-ink-4 tabular-nums truncate">
                        US · {fedSiteCount} sites · {(fedCapacityMw / 1000).toFixed(2)} GW · {visibleClasses.map(c => CLASS_LABEL[c]).join(' · ')}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[12px] font-semibold text-ink tabular-nums">
                        {fmtUsd(fedStatutory)}
                      </div>
                      <div className="text-[9px] text-ink-4 tracking-wide uppercase">
                        statutory min
                      </div>
                    </div>
                  </button>

                  {isFederalOpen && (
                    <div className="bg-canvas border-t border-border/60">
                      {/* Methodology callout */}
                      <div className="px-2.5 py-1.5 bg-amber-50/40 border-b border-border/60 text-[10px] text-ink-3 leading-snug">
                        <span className="font-semibold text-ink-2">Statutory minimum</span>: wind per 43 CFR 2805.20 ($20k × turbines, assumes ≥1MW); solar per BLM IM-2015-138 ($10k/MW, PV only — CSP plants carry project-specific ROD bonds); BESS shown for visibility only (no BLM BESS formula; bonded jointly with host project).{' '}
                        <span className="font-semibold text-ink-2">Caveat</span>: per-site turbine counts and nameplate capacity are hand-entered from public project specs and not verified against the underlying BLM ROD attachment. Treat as a lower-bound multiplication, not a sourced figure. The economic-cost (DCI) overlay and underbond gap will return when per-asset-class DCI series are published.
                      </div>

                      {visibleClasses.map(cls => {
                        const sitesForClass   = visibleSites.filter(s => s.asset_class === cls)
                        const summaryForClass = visibleSummaries.find(s => s.asset_class === cls)
                        if (!summaryForClass) return null
                        const classStat = summaryForClass.sum_statutory_min_bond_usd
                        const classCap  = Number(summaryForClass.total_capacity_mw ?? 0)
                        return (
                          <div key={cls}>
                            <div className="px-2.5 py-1 bg-titlebar/50 border-b border-border/40 flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[9px] font-bold px-1 py-px rounded-sm border tracking-wide ${ASSET_CLASS_PILL_FED[cls]}`}>
                                  {CLASS_LABEL[cls]}
                                </span>
                                <span className="text-[10px] text-ink-3 tabular-nums">
                                  {sitesForClass.length} sites · {(classCap / 1000).toFixed(2)} GW
                                </span>
                              </div>
                              <div className="text-[10px] text-ink font-semibold tabular-nums">
                                {classStat != null ? `${fmtUsd(classStat)} stat. min` : 'n/a (host-bonded)'}
                              </div>
                            </div>
                            <table className="w-full table-fixed">
                              <colgroup>
                                <col style={{ width: '46%' }} />
                                <col style={{ width: '10%' }} />
                                <col style={{ width: '16%' }} />
                                <col style={{ width: '28%' }} />
                              </colgroup>
                              <thead>
                                <tr className="border-b border-border/60">
                                  <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Project</th>
                                  <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">St</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">MW</th>
                                  <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Statutory min</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sitesForClass.length === 0 ? (
                                  <tr>
                                    <td colSpan={4} className="px-2 py-3 text-[11px] text-ink-3 text-center leading-snug">
                                      No sites curated for {CLASS_LABEL[cls]}.
                                    </td>
                                  </tr>
                                ) : sitesForClass.map(s => (
                                  <tr key={s.blm_serial} className="border-b border-border/40 last:border-0 hover:bg-panel">
                                    <td className="px-2 py-0.5">
                                      <div className="text-[10.5px] text-ink font-medium leading-tight truncate">{s.project_name}</div>
                                      <div className="text-[9px] text-ink-4 tabular-nums leading-tight truncate" title={s.notes ?? undefined}>
                                        {s.operator ?? '—'} · {s.blm_serial}{s.commissioning_year ? ` · ${s.commissioning_year}` : ''}
                                        {s.asset_class === 'onshore_wind' && s.turbine_count ? ` · ${s.turbine_count} turb` : ''}
                                      </div>
                                    </td>
                                    <td className="px-2 py-0.5 text-[10.5px] text-ink-2">{s.state}</td>
                                    <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums text-ink">{Number(s.capacity_mw).toFixed(0)}</td>
                                    <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums text-ink" title={s.statutory_basis ?? undefined}>
                                      {s.statutory_min_bond_usd != null ? fmtUsd(s.statutory_min_bond_usd) : <span className="text-ink-4 italic">n/a</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      })}

                      <div className="px-2 py-1 border-t border-border/60 bg-titlebar text-[10px] text-ink-4">
                        Source: Curated BLM RODs, NEPA documents, ROW serial numbers · 43 CFR 2805.20 (wind) · BLM IM-2015-138 (solar PV)
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Companies House iXBRL · UK operator/SPV provision balances ── */}
              {showCh && (
                <div>
                  <button
                    onClick={() => setExpanded(isChOpen ? null : chKey)}
                    className="w-full px-2.5 py-1.5 text-left hover:bg-raised flex items-center gap-2 bg-blue-50/40">
                    <span className="text-ink-4 text-[10px] tabular-nums w-3">{isChOpen ? '▼' : '▶'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11.5px] font-semibold text-ink truncate flex items-center gap-1.5">
                        UK Companies House · iXBRL
                        <span className="text-[9px] font-bold px-1 py-px rounded-sm border tracking-wide bg-blue-50 text-blue-700 border-blue-200">
                          FILED ACCOUNTS
                        </span>
                      </div>
                      <div className="text-[10px] text-ink-4 tabular-nums truncate">
                        UK · {chCompanyCount} {chCompanyCount === 1 ? 'company' : 'companies'} · decommissioning / restoration provisions
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[12px] font-semibold text-ink tabular-nums">
                        {fmtGbp(chTotalGbp)}
                      </div>
                      <div className="text-[9px] text-ink-4 tracking-wide uppercase">
                        sum of latest provisions
                      </div>
                    </div>
                  </button>

                  {isChOpen && (
                    <div className="bg-canvas border-t border-border/60">
                      <div className="px-2.5 py-1.5 bg-blue-50/40 border-b border-border/60 text-[10px] text-ink-3 leading-snug">
                        Provision balances scraped from <span className="font-semibold text-ink-2">filed iXBRL accounts</span> at UK Companies House. We match XBRL concepts on substring (decommission · dilapidation · restoration · rehabilitation). One row per company, latest period only. PDF-only filings (most large operators) and Channel-Island YieldCos (Greencoat aside) are not at UK CH and don't appear here.
                      </div>
                      <table className="w-full table-fixed">
                        <colgroup>
                          <col style={{ width: '34%' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '14%' }} />
                          <col style={{ width: '20%' }} />
                          <col style={{ width: '18%' }} />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-border/60">
                            <th className="px-2 py-1 text-left  text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Company</th>
                            <th className="px-2 py-1 text-left  text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Group</th>
                            <th className="px-2 py-1 text-left  text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Period</th>
                            <th className="px-2 py-1 text-left  text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Concept</th>
                            <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Provision</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chFiltered.map(c => (
                            <tr key={c.company_number} className="border-b border-border/40 last:border-0 hover:bg-panel">
                              <td className="px-2 py-0.5">
                                <div className="text-[10.5px] text-ink font-medium leading-tight truncate" title={c.company_name}>
                                  {c.company_name}
                                </div>
                                <div className="text-[9px] text-ink-4 tabular-nums leading-tight">
                                  CH · {c.company_number}
                                </div>
                              </td>
                              <td className="px-2 py-0.5 text-[10.5px] text-ink-2 truncate">{c.parent_group ?? '—'}</td>
                              <td className="px-2 py-0.5 text-[10.5px] text-ink-2 tabular-nums">{c.period_end ?? '—'}</td>
                              <td className="px-2 py-0.5 text-[10px] text-ink-3 truncate" title={c.concept_name}>
                                {c.concept_label ?? c.concept_name}
                              </td>
                              <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums text-ink font-semibold">
                                {fmtGbp(c.value_gbp)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="px-2 py-1 border-t border-border/60 bg-titlebar text-[10px] text-ink-4">
                        Source: UK Companies House Document API · iXBRL parse · ingestion/sync_companies_house_ixbrl.py
                      </div>
                    </div>
                  )}
                </div>
              )}

              {operators.map(op => {
                const sym = CCY_SYMBOL[op.currency] ?? op.currency
                const isOpen = expanded === `${op.operator}|${op.fy}`
                const classList = Array.from(op.asset_classes).map(c => ASSET_CLASS_LABEL_SHORT[c]).join(' · ')
                return (
                  <div key={`${op.operator}|${op.fy}`}>
                    {/* Operator summary row */}
                    <button
                      onClick={() => setExpanded(isOpen ? null : `${op.operator}|${op.fy}`)}
                      className="w-full px-2.5 py-1.5 text-left hover:bg-raised flex items-center gap-2">
                      <span className="text-ink-4 text-[10px] tabular-nums w-3">{isOpen ? '▼' : '▶'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-semibold text-ink truncate">
                          {op.operator}{op.operator_ticker && <span className="text-ink-4 font-normal"> · {op.operator_ticker}</span>}
                        </div>
                        <div className="text-[10px] text-ink-4 tabular-nums truncate">
                          {op.jurisdiction} · {op.fy} · {op.site_count} site{op.site_count !== 1 ? 's' : ''} · {classList}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[12px] font-semibold text-ink tabular-nums">
                          {formatBond(op.total_thousands, sym)}
                        </div>
                        {op.pure_decom_thousands < op.total_thousands && (() => {
                          const bundledThousands = op.total_thousands - op.pure_decom_thousands
                          const bundledCount = op.rows.filter(r => !r.purpose_pure_decom).length
                          return (
                            <div className="text-[9px] text-amber-700 tabular-nums leading-tight"
                                 title={`${bundledCount} bond${bundledCount !== 1 ? 's' : ''} bundle decommissioning with other obligations (e.g. grid security, radar mitigation, wake compensation). Exclude these bonds for a pure-decom view.`}>
                              of which {formatBond(bundledThousands, sym)} bundled w/ grid·radar·wake
                            </div>
                          )
                        })()}
                      </div>
                    </button>

                    {/* Expanded per-site detail — grouped by asset class, sites aggregated by name */}
                    {isOpen && (() => {
                      // Aggregate bond rows by site_name within each asset class.
                      // Multi-beneficiary sites (e.g. South Kyle has 4 separate counter-indemnities)
                      // collapse to one row that lists all beneficiaries.
                      interface SiteAgg {
                        site_name:        string
                        site_asset_class: AroBondRow['site_asset_class']
                        site_capacity_mw: number | null
                        ownership_pct:    number | null
                        bond_currency:    string
                        total_thousands:  number
                        beneficiaries:    string[]
                        any_mixed:        boolean
                        mixed_notes:      string[]   // unique purpose_notes for mixed-purpose constituents
                      }

                      const siteMap = new Map<string, SiteAgg>()
                      for (const r of op.rows) {
                        const key = `${r.site_name}|${r.site_asset_class}`
                        let s = siteMap.get(key)
                        if (!s) {
                          s = {
                            site_name: r.site_name, site_asset_class: r.site_asset_class,
                            site_capacity_mw: r.site_capacity_mw, ownership_pct: r.ownership_pct,
                            bond_currency: r.bond_currency, total_thousands: 0,
                            beneficiaries: [], any_mixed: false, mixed_notes: [],
                          }
                          siteMap.set(key, s)
                        }
                        s.total_thousands += r.bond_amount_thousands
                        if (!s.beneficiaries.includes(r.beneficiary)) s.beneficiaries.push(r.beneficiary)
                        if (!r.purpose_pure_decom) {
                          s.any_mixed = true
                          if (r.purpose_notes && !s.mixed_notes.includes(r.purpose_notes)) {
                            s.mixed_notes.push(r.purpose_notes)
                          }
                        }
                      }

                      // Order classes for display, then sort sites within each by total bond desc
                      const CLASS_ORDER: AroBondRow['site_asset_class'][] = ['offshore_wind', 'onshore_wind', 'solar_pv', 'bess']
                      const allSites = Array.from(siteMap.values())
                      const groups = CLASS_ORDER
                        .map(cls => ({
                          cls,
                          sites: allSites.filter(s => s.site_asset_class === cls)
                                         .sort((a, b) => b.total_thousands - a.total_thousands),
                        }))
                        .filter(g => g.sites.length > 0)

                      const ASSET_CLASS_PILL: Record<AroBondRow['site_asset_class'], string> = {
                        offshore_wind: 'bg-sky-50 text-sky-700 border-sky-200',
                        onshore_wind:  'bg-teal-50 text-teal-700 border-teal-200',
                        solar_pv:      'bg-amber-50 text-amber-700 border-amber-200',
                        bess:          'bg-violet-50 text-violet-700 border-violet-200',
                      }

                      const sitePerMwK = (s: SiteAgg): number | null => {
                        if (!s.site_capacity_mw || s.site_capacity_mw <= 0) return null
                        const attributable = s.site_capacity_mw * ((s.ownership_pct ?? 100) / 100)
                        return attributable > 0 ? s.total_thousands / attributable : null
                      }

                      const formatBeneficiaries = (list: string[]): string => {
                        if (list.length === 1) return list[0]
                        if (list.length === 2) return list.join(' · ')
                        return `${list[0]} +${list.length - 1}`
                      }

                      return (
                        <div className="bg-canvas border-t border-border/60">
                          {groups.map(g => {
                            const subtotal = g.sites.reduce((s, x) => s + x.total_thousands, 0)
                            const totalAttribMw = g.sites.reduce((s, x) =>
                              s + (x.site_capacity_mw ?? 0) * ((x.ownership_pct ?? 100) / 100), 0)
                            const blendedPerMw = totalAttribMw > 0 ? subtotal / totalAttribMw : null
                            const groupSym = CCY_SYMBOL[g.sites[0].bond_currency] ?? g.sites[0].bond_currency

                            return (
                              <div key={g.cls}>
                                {/* Asset-class subheader */}
                                <div className="flex items-center gap-2 px-2 py-1 bg-titlebar border-b border-border/70">
                                  <span className={clsx(
                                    'text-[9px] font-bold px-1 py-px rounded-sm border tracking-wide',
                                    ASSET_CLASS_PILL[g.cls],
                                  )}>
                                    {ASSET_CLASS_LABEL_SHORT[g.cls]}
                                  </span>
                                  <span className="text-[9.5px] text-ink-4 tabular-nums">
                                    {g.sites.length} site{g.sites.length !== 1 ? 's' : ''}
                                  </span>
                                  <span className="ml-auto text-[10.5px] tabular-nums">
                                    <span className="text-ink-4 mr-1">Σ</span>
                                    <span className="text-ink font-semibold">{formatBond(subtotal, groupSym)}</span>
                                    {blendedPerMw != null && (
                                      <span className="text-ink-3 ml-2">
                                        ≈ {groupSym}{blendedPerMw.toFixed(0)}k/MW
                                      </span>
                                    )}
                                  </span>
                                </div>

                                {/* Aggregated site rows — table-fixed with explicit colgroup so all
                                    asset-class subtables align column widths identically */}
                                <table className="w-full table-fixed">
                                  <colgroup>
                                    <col style={{ width: '34%' }} />
                                    <col style={{ width: '36%' }} />
                                    <col style={{ width: '15%' }} />
                                    <col style={{ width: '15%' }} />
                                  </colgroup>
                                  <thead>
                                    <tr className="border-b border-border/60">
                                      <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Site</th>
                                      <th className="px-2 py-1 text-left text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Beneficiaries</th>
                                      <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">Bond</th>
                                      <th className="px-2 py-1 text-right text-[9px] font-semibold text-ink-4 uppercase tracking-wide">
                                        <span className="normal-case">{groupSym}k</span>/MW
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.sites.map((s, idx) => {
                                      const rsym = CCY_SYMBOL[s.bond_currency] ?? s.bond_currency
                                      const pmw = sitePerMwK(s)
                                      return (
                                        <tr key={`${s.site_name}-${idx}`} className="border-b border-border/40 last:border-0 hover:bg-panel">
                                          <td className="px-2 py-0.5">
                                            <div className="text-[10.5px] text-ink font-medium leading-tight truncate">{s.site_name}</div>
                                            {s.site_capacity_mw != null && (
                                              <div className="text-[9px] text-ink-4 tabular-nums leading-tight">
                                                {s.site_capacity_mw} MW{s.ownership_pct != null && s.ownership_pct < 100 ? ` · ${s.ownership_pct}% stake` : ''}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-2 py-0.5">
                                            <div className="text-[10.5px] text-ink-2 truncate" title={s.beneficiaries.join(' · ')}>
                                              {formatBeneficiaries(s.beneficiaries)}
                                            </div>
                                            {s.any_mixed && (
                                              <div className="text-[9px] text-amber-700 leading-tight" title={s.mixed_notes.join(' · ')}>
                                                bundled: {s.mixed_notes.join('; ').replace(/^Combined:\s*/i, '')}
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums text-ink font-semibold">
                                            {formatBond(s.total_thousands, rsym)}
                                          </td>
                                          <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums">
                                            {pmw != null
                                              ? <span className={clsx(s.any_mixed && 'text-amber-700')}>{pmw.toFixed(0)}</span>
                                              : <span className="text-ink-4">—</span>}
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )
                          })}

                          {op.rows[0]?.source_url && (
                            <div className="px-2 py-1 border-t border-border/60 bg-titlebar">
                              <a href={op.rows[0].source_url + (op.rows[0].filing_page ? `#page=${op.rows[0].filing_page}` : '')}
                                 target="_blank" rel="noopener noreferrer"
                                 className="flex items-center gap-1 text-[10px] text-teal hover:text-teal-bright hover:underline">
                                <ExternalLink size={9} />{op.rows[0].source_name}
                              </a>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border px-2.5 py-1 text-[9.5px] text-ink-4 leading-snug">
          Operator-posted bonds + BLM regulator-implied · onshore vs offshore separated · click row to expand
        </div>
      </div>
        )
      })()}
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

      {/* 12-col panel grid — viewport-fit, 2 rows, panels scroll internally
            Row 1: Signal Tape (col-8) + Decom Mandates (col-4)
            Row 2: Provisions (col-6) + Bonds (col-6) */}
      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-12 grid-rows-2 gap-1.5">
          <SignalTapePanel />
          <DecomMandatesPanel />
          <ProvisionsPanel />
          <BondsPanel />
        </div>
      </div>

    </div>
  )
}
