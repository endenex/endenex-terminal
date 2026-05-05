// ── Market Watch — Tab 07 ────────────────────────────────────────────────────
// Spec: Product Brief v1.0 §6.7
//
// Sub-tabs:
//   01 Signal Tape (default) — broad-coverage curated feed with liability tags
//   02 Tender Flow           — TED / Find a Tender / SAM.gov
//   03 Provision Disclosures — CSRD / TCFD / annual reports
//   04 Capacity Signals      — PCM-driven facility status changes
//   05 Commodity Refs        — Argus / LME / BMI reference prices

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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

type SubTab = 'signal' | 'tender' | 'disclosures' | 'capacity' | 'commodity'

// ── Constants ─────────────────────────────────────────────────────────────────

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'signal',      label: 'Signal Tape' },
  { id: 'tender',      label: 'Tender Flow' },
  { id: 'disclosures', label: 'Provision Disclosures' },
  { id: 'capacity',    label: 'Capacity Signals' },
  { id: 'commodity',   label: 'Commodity Refs' },
]

const CATEGORIES: { code: WatchCategory | 'all'; label: string }[] = [
  { code: 'all',          label: 'All signals' },
  { code: 'market',       label: 'Market' },
  { code: 'regulatory',   label: 'Regulatory' },
  { code: 'commodity',    label: 'Commodity' },
  { code: 'supply_chain', label: 'Supply Chain' },
]

const CATEGORY_PILL: Record<WatchCategory, string> = {
  market:       'bg-blue-50 text-blue-700 border border-blue-200',
  regulatory:   'bg-amber-50 text-amber-700 border border-amber-200',
  commodity:    'bg-teal-50 text-teal-600 border border-teal-200',
  supply_chain: 'bg-violet-50 text-violet-700 border border-violet-200',
}

const CATEGORY_LABEL: Record<WatchCategory, string> = {
  market: 'Market', regulatory: 'Regulatory',
  commodity: 'Commodity', supply_chain: 'Supply Chain',
}

// Liability-impact tag display — brief §6.7.2
const LIABILITY_TAG_STYLE: Record<string, { label: string; className: string }> = {
  COST_UP: { label: 'COST▲', className: 'bg-red-50 text-down border border-red-200' },
  COST_DN: { label: 'COST▼', className: 'bg-green-50 text-up border border-green-200' },
  REC_UP:  { label: 'REC▲',  className: 'bg-green-50 text-up border border-green-200' },
  REC_DN:  { label: 'REC▼',  className: 'bg-red-50 text-down border border-red-200' },
  CAP:     { label: 'CAP',   className: 'bg-teal-50 text-teal border border-teal-200' },
  POL:     { label: 'POL',   className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  PROV:    { label: 'PROV',  className: 'bg-violet-50 text-violet-700 border border-violet-200' },
}

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-highlight',
  Low:    'text-down',
}

// Scope includes JP now — brief §6.7 + migration 009
const SCOPES = ['GB', 'EU', 'US', 'JP', 'DE', 'DK', 'FR', 'ES', 'NL', 'SE', 'AU', 'Global']

const SCOPE_LABEL: Record<string, string> = {
  GB: 'UK', EU: 'EU', US: 'US', JP: 'Japan', DE: 'Germany',
  DK: 'Denmark', FR: 'France', ES: 'Spain', NL: 'Netherlands',
  SE: 'Sweden', AU: 'Australia', Global: 'Global',
}

const PAGE_SIZE = 50

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch { return '—' }
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
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11.5px] font-medium bg-panel border border-border rounded hover:border-teal/40 text-ink-2 transition-colors"
      >
        {label}
        <ChevronDown size={11} className="text-ink-4" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-20 bg-panel border border-border rounded shadow-panel-md min-w-[160px]">
          {SCOPES.map(s => (
            <button
              key={s}
              onClick={() => toggle(s)}
              className="flex items-center justify-between w-full px-3 py-2 text-[11.5px] text-ink-2 hover:bg-page transition-colors"
            >
              <span>{SCOPE_LABEL[s] ?? s}</span>
              <span className="text-[9px] font-semibold text-ink-4 ml-3">{s}</span>
              {selected.includes(s) && (
                <span className="text-teal text-[10px] ml-2">✓</span>
              )}
            </button>
          ))}
          {selected.length > 0 && (
            <>
              <div className="border-t border-border" />
              <button
                onClick={() => onChange([])}
                className="w-full px-3 py-2 text-[11px] text-ink-3 hover:text-ink hover:bg-page transition-colors text-left"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      )}
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
          <span
            key={tag}
            className={clsx('text-[9.5px] font-semibold px-1.5 py-px rounded', style.className)}
          >
            {style.label}
          </span>
        )
      })}
    </div>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ event, onClose }: { event: WatchEvent; onClose: () => void }) {
  const entity     = event.site_name || event.company_name || event.developer
  const sourceLink = event.source_url || event.watch_sources?.url

  return (
    <div className="w-80 flex-shrink-0 border-l border-border bg-panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <span className={clsx('text-[9.5px] font-semibold px-2 py-0.5 rounded', CATEGORY_PILL[event.category])}>
          {CATEGORY_LABEL[event.category]}
        </span>
        <button
          onClick={onClose}
          className="text-ink-3 hover:text-ink text-lg leading-none transition-colors"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div>
          <p className="text-[13px] font-semibold text-ink leading-snug mb-1">
            {event.headline}
          </p>
          <p className="text-[11px] text-ink-3">{event.event_type}</p>
        </div>

        {event.liability_tags?.length > 0 && (
          <div>
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1.5">
              Liability impact
            </div>
            <LiabilityTags tags={event.liability_tags} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-[11.5px]">
          {[
            { label: 'Region',     value: SCOPE_LABEL[event.scope] ?? event.scope },
            { label: 'Date',       value: fmtDate(event.event_date) },
            { label: 'Confidence', value: event.confidence, className: CONFIDENCE_STYLE[event.confidence] },
            { label: 'Reviewed',   value: fmtDate(event.last_reviewed) },
          ].map(({ label, value, className }) => (
            <div key={label}>
              <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">{label}</div>
              <div className={clsx('font-medium text-ink-2', className)}>{value}</div>
            </div>
          ))}
        </div>

        {entity && (
          <div>
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">
              {event.site_name ? 'Site' : 'Entity'}
            </div>
            <div className="text-[11.5px] font-medium text-ink-2">{entity}</div>
            {event.capacity_mw != null && (
              <div className="text-[11px] text-ink-3 mt-0.5">{event.capacity_mw} MW</div>
            )}
          </div>
        )}

        {event.notes && (
          <div>
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1.5">Notes</div>
            <p className="text-[11.5px] text-ink-2 leading-relaxed">{event.notes}</p>
          </div>
        )}

        {(event.watch_sources || event.source_url) && (
          <div>
            <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1.5">
              {event.source_count > 1 ? `Source · ${event.source_count} outlets` : 'Source'}
            </div>
            <div className="text-[11.5px] text-ink-2">{event.watch_sources?.name ?? '—'}</div>
            {sourceLink && (
              <a
                href={sourceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-teal hover:underline mt-1"
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

// ── Signal Tape sub-tab ───────────────────────────────────────────────────────

function SignalTape() {
  const [category,   setCategory]   = useState<WatchCategory | 'all'>('all')
  const [scopes,     setScopes]     = useState<string[]>([])
  const [confidence, setConfidence] = useState<string | null>(null)
  const [events,     setEvents]     = useState<WatchEvent[]>([])
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState<WatchEvent | null>(null)
  const [page,       setPage]       = useState(0)

  useEffect(() => { setPage(0); setSelected(null) }, [category, scopes, confidence])

  const load = useCallback(async (spinner = false) => {
    if (spinner) setLoading(true)
    try {
      let q = supabase
        .from('watch_events')
        .select('*, watch_sources(id, name, url)')
        .eq('is_duplicate', false)
        .order('event_date', { ascending: false })

      if (category !== 'all') q = q.eq('category', category)
      if (scopes.length > 0)  q = q.in('scope', scopes)
      if (confidence)         q = q.eq('confidence', confidence)

      const { data } = await q
      setEvents((data as WatchEvent[]) ?? [])
    } finally {
      if (spinner) setLoading(false)
    }
  }, [category, scopes, confidence])

  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [load])

  const paged      = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(events.length / PAGE_SIZE)

  const updatedAt = useMemo(() => {
    if (events.length === 0) return null
    return events.reduce(
      (max, e) => (e.last_reviewed > max ? e.last_reviewed : max),
      events[0].last_reviewed,
    )
  }, [events])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center justify-between px-5 py-2 border-b border-border bg-panel flex-shrink-0 gap-4">
        {/* Category tabs */}
        <div className="flex items-center gap-0">
          {CATEGORIES.map(({ code, label }) => (
            <button
              key={code}
              onClick={() => setCategory(code)}
              className={clsx(
                'px-4 py-2 text-[11.5px] font-medium border-b-2 transition-colors',
                category === code
                  ? 'border-teal text-teal'
                  : 'border-transparent text-ink-3 hover:text-ink-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ScopeDropdown selected={scopes} onChange={setScopes} />
          {(['High', 'Medium', 'Low'] as const).map(c => (
            <button
              key={c}
              onClick={() => setConfidence(prev => prev === c ? null : c)}
              className={clsx(
                'px-2.5 py-1.5 text-[10.5px] font-semibold rounded border transition-colors',
                confidence === c
                  ? `border-current ${CONFIDENCE_STYLE[c]} bg-page`
                  : 'text-ink-4 border-border hover:text-ink-2',
              )}
            >
              {c}
            </button>
          ))}
          {updatedAt && (
            <span className="text-[10px] text-ink-4 ml-2 hidden lg:block">
              Updated {fmtDate(updatedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Feed */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto divide-y divide-border">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-5 py-4 space-y-2 animate-pulse">
                  <div className="flex gap-2">
                    <div className="h-3 bg-page rounded w-16" />
                    <div className="h-3 bg-page rounded w-20" />
                  </div>
                  <div className="h-4 bg-page rounded w-3/4" />
                  <div className="h-3 bg-page rounded w-1/2" />
                </div>
              ))
            ) : paged.length === 0 ? (
              <div className="px-5 py-12 text-center text-[12px] text-ink-3">
                No signals found. The feed is updated daily.
              </div>
            ) : paged.map(ev => {
              const isSelected = selected?.id === ev.id
              const entity     = ev.site_name || ev.company_name || ev.developer
              const entityLine = [entity, ev.capacity_mw != null ? `${ev.capacity_mw} MW` : null]
                .filter(Boolean).join(' · ')

              return (
                <div
                  key={ev.id}
                  onClick={() => setSelected(s => s?.id === ev.id ? null : ev)}
                  className={clsx(
                    'px-5 py-4 cursor-pointer transition-colors border-l-2',
                    isSelected
                      ? 'bg-active border-l-teal'
                      : 'hover:bg-page border-l-transparent',
                  )}
                >
                  {/* Meta strip */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-[10.5px] text-ink-3">{fmtDate(ev.event_date)}</span>
                    <span className="text-ink-4">·</span>
                    <span className={clsx('text-[9.5px] font-semibold px-1.5 py-px rounded', CATEGORY_PILL[ev.category])}>
                      {CATEGORY_LABEL[ev.category]}
                    </span>
                    <span className="text-[11px] text-ink-3">{ev.event_type}</span>
                    <span className="text-ink-4">·</span>
                    <span className="text-[10.5px] font-medium text-ink-3">
                      {SCOPE_LABEL[ev.scope] ?? ev.scope}
                    </span>
                    <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                      <LiabilityTags tags={ev.liability_tags ?? []} />
                      <span className={clsx('text-[10.5px] font-semibold', CONFIDENCE_STYLE[ev.confidence])}>
                        {ev.confidence}
                      </span>
                      {ev.watch_sources?.name && (
                        <span className="text-[10.5px] text-ink-4 max-w-[140px] truncate">
                          {ev.watch_sources.name}
                          {ev.source_count > 1 && <span className="text-ink-4"> +{ev.source_count - 1}</span>}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Headline */}
                  <h3 className="text-[13px] font-semibold text-ink leading-snug mb-1.5">
                    {ev.headline}
                  </h3>

                  {/* Notes */}
                  {ev.notes && (
                    <p className="text-[11.5px] text-ink-3 leading-relaxed line-clamp-2">
                      {ev.notes}
                    </p>
                  )}

                  {/* Entity tag */}
                  {entityLine && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <div className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
                      <span className="text-[10.5px] text-ink-4">{entityLine}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-2.5 border-t border-border text-[11px] text-ink-3 flex-shrink-0 bg-panel">
              <span>{events.length} signals</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 border border-border rounded disabled:opacity-30 hover:text-ink transition-colors"
                >
                  Prev
                </button>
                <span>{page + 1} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 border border-border rounded disabled:opacity-30 hover:text-ink transition-colors"
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

// ── Placeholder sub-tab ───────────────────────────────────────────────────────

function PlaceholderSubTab({
  title, description, sources,
}: { title: string; description: string; sources: string[] }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 px-6 text-center">
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      <p className="text-[11.5px] text-ink-3 max-w-sm leading-relaxed">{description}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {sources.map(s => (
          <span key={s} className="text-[10px] font-medium px-2 py-1 bg-page border border-border rounded text-ink-3">
            {s}
          </span>
        ))}
      </div>
      <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest bg-page border border-border px-3 py-1 rounded">
        Ingestion in build
      </span>
    </div>
  )
}

// ── Commodity Refs sub-tab ────────────────────────────────────────────────────

interface CommodityRow {
  material_type:   string
  price_per_tonne: number
  currency:        string
  price_date:      string
  region:          string
}

const MATERIAL_LABELS: Record<string, string> = {
  steel_hms1:      'Steel HMS 1',
  steel_hms2:      'Steel HMS 2',
  steel_cast_iron: 'Cast Iron',
  copper:          'Copper',
  aluminium:       'Aluminium',
  zinc:            'Zinc',
  rare_earth:      'Nd-Pr Oxide',
}

const MATERIAL_SOURCE: Record<string, string> = {
  steel_hms1: 'Argus',
  steel_hms2: 'Argus',
  copper:     'LME',
  aluminium:  'LME',
  zinc:       'LME',
  rare_earth: 'BMI',
}

type CcyRegion = 'EU' | 'GB' | 'US'
const CCY_REGIONS: { code: CcyRegion; label: string; currency: string }[] = [
  { code: 'EU', label: 'EU', currency: 'EUR' },
  { code: 'GB', label: 'UK', currency: 'GBP' },
  { code: 'US', label: 'US', currency: 'USD' },
]

function CommodityRefs() {
  const [region,  setRegion]  = useState<CcyRegion>('EU')
  const [prices,  setPrices]  = useState<CommodityRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('commodity_prices')
      .select('material_type, price_per_tonne, currency, price_date, region')
      .eq('region', region)
      .order('price_date', { ascending: false })
      .then(({ data }) => {
        if (!data) { setLoading(false); return }
        const seen = new Set<string>()
        const deduped: CommodityRow[] = []
        for (const row of data as CommodityRow[]) {
          if (!seen.has(row.material_type)) {
            seen.add(row.material_type)
            deduped.push(row)
          }
        }
        setPrices(deduped)
        setLoading(false)
      })
  }, [region])

  const ccy = CCY_REGIONS.find(r => r.code === region)?.currency ?? 'EUR'

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Region tabs */}
      <div className="flex items-center gap-0 px-5 border-b border-border bg-panel flex-shrink-0">
        {CCY_REGIONS.map(r => (
          <button
            key={r.code}
            onClick={() => setRegion(r.code)}
            className={clsx(
              'px-4 py-2.5 text-[11.5px] font-medium border-b-2 transition-colors',
              region === r.code
                ? 'border-teal text-teal'
                : 'border-transparent text-ink-3 hover:text-ink-2',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Price table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-page text-left">
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Material</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">Price</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Source</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Date</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">m/m</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-5 py-3">
                      <div className="h-3 bg-page rounded w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : prices.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-ink-3">
                  No prices for {region} yet
                </td>
              </tr>
            ) : prices.map(row => (
              <tr key={row.material_type} className="hover:bg-page transition-colors">
                <td className="px-5 py-3 font-medium text-ink">
                  {MATERIAL_LABELS[row.material_type] ?? row.material_type}
                </td>
                <td className="px-5 py-3 text-right font-semibold text-ink tabular-nums">
                  {new Intl.NumberFormat('en-GB', {
                    style: 'currency', currency: ccy, maximumFractionDigits: 0,
                  }).format(row.price_per_tonne)}
                  <span className="text-ink-3 font-normal text-[10px]">/t</span>
                </td>
                <td className="px-5 py-3 text-ink-3">{MATERIAL_SOURCE[row.material_type] ?? '—'}</td>
                <td className="px-5 py-3 text-ink-3">{fmtDate(row.price_date)}</td>
                <td className="px-5 py-3 text-ink-4">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WatchPage() {
  const [subTab, setSubTab] = useState<SubTab>('signal')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab nav */}
      <div className="flex-shrink-0 flex items-stretch border-b border-border bg-panel">
        <div className="flex items-stretch px-5 gap-0">
          {SUB_TABS.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={clsx(
                'relative px-4 py-3 text-[11.5px] font-medium border-b-2 transition-colors whitespace-nowrap',
                subTab === t.id
                  ? 'border-teal text-teal'
                  : 'border-transparent text-ink-3 hover:text-ink-2',
              )}
            >
              <span className="text-[9px] text-ink-4 mr-1.5">{String(i + 1).padStart(2, '0')}</span>
              {t.label}
            </button>
          ))}
        </div>
        {/* Coverage note */}
        <div className="ml-auto flex items-center pr-5 gap-2">
          <span className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest">Coverage</span>
          {['GB', 'EU', 'US', 'JP'].map(s => (
            <span key={s} className="text-[9.5px] font-semibold px-1.5 py-px bg-page border border-border rounded text-ink-3">
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Sub-tab content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {subTab === 'signal' && <SignalTape />}

        {subTab === 'tender' && (
          <PlaceholderSubTab
            title="Tender Flow"
            description="Public procurement notices for decommissioning, site restoration, and blade processing contracts."
            sources={['TED Europa', 'Find a Tender (UK)', 'SAM.gov (US)', 'METI Procurement (JP)']}
          />
        )}

        {subTab === 'disclosures' && (
          <PlaceholderSubTab
            title="Provision Disclosures"
            description="Operator ARO disclosures from mandatory reporting frameworks — CSRD, TCFD, iXBRL, and METI."
            sources={['Companies House iXBRL', 'SEC EDGAR', 'CSRD ESEF', 'METI Mandatory Reserves']}
          />
        )}

        {subTab === 'capacity' && (
          <PlaceholderSubTab
            title="Capacity Signals"
            description="Facility status changes, gate-fee moves, and stockpile signals from the Processing Capacity Monitor."
            sources={['PCM Composite Blade', 'PCM Metals Recovery', 'PCM PV Recycling']}
          />
        )}

        {subTab === 'commodity' && <CommodityRefs />}
      </div>
    </div>
  )
}
