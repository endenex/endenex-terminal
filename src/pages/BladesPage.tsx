// ── Processing Capacity Monitor — Tab 05 ─────────────────────────────────────
// Spec: Product Brief v1.0 §6.5
//
// Sub-tabs:
//   01 Composite Blades    — GRP blade waste volumes by region + recycling pathways
//   02 Facility Directory  — recycler and processor locations (pending)
//   03 Gate Fees           — tipping / gate fee ranges by pathway (pending)
//   04 Capacity Signals    — Watch feed supply_chain signals

import { useState, useEffect } from 'react'
import { clsx } from 'clsx'
import { ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { BladePathwayBars } from '@/components/charts/BladePathwayBars'

// ── Types ─────────────────────────────────────────────────────────────────────

type SubTab = 'blades' | 'directory' | 'fees' | 'signals'

interface WatchEvent {
  id:           string
  headline:     string
  notes:        string | null
  event_type:   string
  scope:        string
  company_name: string | null
  capacity_mw:  number | null
  event_date:   string
  confidence:   'High' | 'Medium' | 'Low'
  source_url:   string | null
  watch_sources: { name: string; url: string | null } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'blades',    label: 'Composite Blades' },
  { id: 'directory', label: 'Facility Directory' },
  { id: 'fees',      label: 'Gate Fees' },
  { id: 'signals',   label: 'Capacity Signals' },
]

const CONFIDENCE_STYLE: Record<string, string> = {
  High:   'text-up',
  Medium: 'text-highlight',
  Low:    'text-down',
}

const SCOPE_LABEL: Record<string, string> = {
  GB: 'UK', EU: 'EU', US: 'US', JP: 'Japan', DE: 'Germany',
  DK: 'Denmark', FR: 'France', ES: 'Spain', NL: 'Netherlands',
  SE: 'Sweden', AU: 'Australia', Global: 'Global',
}

// ── Blade volume data (indicative — pending IRENA/LCA registry ingestion) ─────

interface BladeRegionRow {
  region:       string
  label:        string
  turbines_eol: string  // estimate or TBC
  blade_count:  string
  grp_kt:       string  // kilotonnes GRP
  horizon:      string
  note:         string
}

const BLADE_REGIONS: BladeRegionRow[] = [
  {
    region: 'EU',
    label:  'Europe',
    turbines_eol: '~12,000',
    blade_count:  '~36,000',
    grp_kt:       '~360 kt',
    horizon:      '2025–2030',
    note:         'German, Danish, and Spanish legacy fleets. IRENA projects 43 kt/yr EU-wide by 2030.',
  },
  {
    region: 'GB',
    label:  'United Kingdom',
    turbines_eol: '~3,500',
    blade_count:  '~10,500',
    grp_kt:       '~90 kt',
    horizon:      '2025–2032',
    note:         'ScotWind legacy fleet + 1990s–2000s onshore fleet reaching 25-yr EOL.',
  },
  {
    region: 'US',
    label:  'United States',
    turbines_eol: '~8,000',
    blade_count:  '~24,000',
    grp_kt:       '~190 kt',
    horizon:      '2024–2030',
    note:         'Midwest and Texas fleets. Landfill bans in IL, CO driving pathway demand.',
  },
  {
    region: 'JP',
    label:  'Japan',
    turbines_eol: 'TBC',
    blade_count:  'TBC',
    grp_kt:       'TBC',
    horizon:      '2030–2040',
    note:         'Post-FIT cohort — blade volumes dependent on METI registry ingestion.',
  },
]

// ── Recycling pathways ────────────────────────────────────────────────────────

interface PathwayRow {
  name:        string
  type:        'thermal' | 'mechanical' | 'chemical' | 'cement' | 'landfill'
  trl:         string    // Technology Readiness Level
  cost_range:  string    // gate fee range
  capacity:    string
  limitations: string
  players:     string
}

const PATHWAYS: PathwayRow[] = [
  {
    name:        'Cement co-processing',
    type:        'thermal',
    trl:         'TRL 9 (commercial)',
    cost_range:  '€130–€200 / t',
    capacity:    'High — EU industrial scale',
    limitations: 'CO₂ emissions not offset. Some markets restricting inorganic waste co-processing.',
    players:     'Holcim, Heidelberg Materials, CEMEX',
  },
  {
    name:        'Mechanical shredding',
    type:        'mechanical',
    trl:         'TRL 8–9',
    cost_range:  '€80–€150 / t',
    capacity:    'Medium — limited specialist shredders',
    limitations: 'Output (shred) has limited secondary market. GRP filler applications only.',
    players:     'Global Fiberglass Solutions (US), various EU operators',
  },
  {
    name:        'Pyrolysis',
    type:        'thermal',
    trl:         'TRL 5–7',
    cost_range:  '€200–€400 / t (est.)',
    capacity:    'Low — pilot / early commercial',
    limitations: 'High energy input. rCF quality variable. Not yet at wind-scale volumes.',
    players:     'Siemens Gamesa (RecyclableBlade), Carbon Rivers (US)',
  },
  {
    name:        'Solvolysis / chemical recycling',
    type:        'chemical',
    trl:         'TRL 3–6',
    cost_range:  'Not commercially quoted',
    capacity:    'Very low — research / pilot',
    limitations: 'High cost, long processing time. rCF high quality but process not scalable yet.',
    players:     'Universities, Olin/Aditya Birla (research)',
  },
  {
    name:        'Landfill (EU restricted)',
    type:        'landfill',
    trl:         'N/A',
    cost_range:  '€50–€120 / t',
    capacity:    'Banned/restricted in EU27, Germany, France, Netherlands',
    limitations: 'EU landfill ban (2025 effective). Permitted in US but facing state-level bans.',
    players:     '—',
  },
]

const PATHWAY_STYLE: Record<PathwayRow['type'], string> = {
  thermal:    'bg-orange-50 text-orange-700 border-orange-200',
  mechanical: 'bg-blue-50 text-blue-700 border-blue-200',
  chemical:   'bg-violet-50 text-violet-700 border-violet-200',
  cement:     'bg-teal-50 text-teal border-teal-200',
  landfill:   'bg-red-50 text-down border-red-200',
}

const PATHWAY_LABEL: Record<PathwayRow['type'], string> = {
  thermal:    'Thermal',
  mechanical: 'Mechanical',
  chemical:   'Chemical',
  cement:     'Thermal',
  landfill:   'Landfill',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch { return '—' }
}

// ── 01 Composite Blades ───────────────────────────────────────────────────────

function CompositeBlades() {
  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      {/* Hero callout */}
      <div className="max-w-3xl mb-8">
        <div className="bg-panel border border-border rounded-lg px-6 py-5">
          <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-2">
            Blade waste — global EOL wave
          </div>
          <div className="flex items-end gap-6">
            <div>
              <div className="text-[36px] font-semibold text-ink tabular-nums leading-none">~43 kt</div>
              <div className="text-[11px] text-ink-3 mt-1">GRP blade waste / year by 2030 (EU only)</div>
            </div>
            <div className="text-ink-4 text-[24px] font-light mb-1">·</div>
            <div>
              <div className="text-[28px] font-semibold text-ink tabular-nums leading-none">~220 kt</div>
              <div className="text-[11px] text-ink-3 mt-1">estimated EU cumulative through 2025</div>
            </div>
            <div className="text-ink-4 text-[24px] font-light mb-1">·</div>
            <div>
              <div className="text-[28px] font-semibold text-ink tabular-nums leading-none">14 t</div>
              <div className="text-[11px] text-ink-3 mt-1">average GRP per blade (2 MW onshore)</div>
            </div>
          </div>
          <div className="text-[10.5px] text-ink-4 mt-3">
            Source: IRENA (2023) · WindEurope · MAKE Consulting. Volumes indicative — pending asset registry ingestion.
          </div>
        </div>
      </div>

      <div className="max-w-5xl grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Volume by region */}
        <div>
          <h3 className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest mb-3">
            EOL volume by region (indicative)
          </h3>
          <div className="bg-panel border border-border rounded-lg overflow-hidden">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Region</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Blades</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-ink-3 text-[10px] uppercase tracking-wider">GRP kt</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Horizon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {BLADE_REGIONS.map(r => (
                  <tr key={r.region} className="hover:bg-page transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{r.label}</div>
                      <div className="text-[10.5px] text-ink-3 mt-0.5 leading-snug">{r.note}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">{r.blade_count}</td>
                    <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">{r.grp_kt}</td>
                    <td className="px-4 py-3 text-ink-3 whitespace-nowrap">{r.horizon}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2.5 border-t border-border bg-page text-[10px] text-ink-4">
              All estimates pending integration with asset registry. TBC = to be confirmed from METI/IRENA data.
            </div>
          </div>
        </div>

        {/* Recycling pathways */}
        <div>
          <h3 className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest mb-3">
            Recycling pathways
          </h3>
          <div className="space-y-2">
            {PATHWAYS.map(p => (
              <div key={p.name} className="bg-panel border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[12px] font-semibold text-ink">{p.name}</span>
                  <span className={clsx(
                    'text-[9.5px] font-semibold px-1.5 py-px rounded border ml-auto flex-shrink-0',
                    PATHWAY_STYLE[p.type],
                  )}>
                    {PATHWAY_LABEL[p.type]}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div className="text-ink-3">
                    <span className="text-ink-4">TRL · </span>{p.trl}
                  </div>
                  <div className="text-ink-3">
                    <span className="text-ink-4">Gate fee · </span>{p.cost_range}
                  </div>
                  <div className="col-span-2 text-ink-3">
                    <span className="text-ink-4">Capacity · </span>{p.capacity}
                  </div>
                  <div className="col-span-2 text-ink-3">
                    <span className="text-ink-4">Limits · </span>{p.limitations}
                  </div>
                  <div className="col-span-2 text-ink-3">
                    <span className="text-ink-4">Players · </span>{p.players}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 02 Facility Directory ─────────────────────────────────────────────────────

const FACILITY_SIGNAL_ROWS = [
  { field: 'Facility name',          status: 'planned' },
  { field: 'Operator / owner',       status: 'planned' },
  { field: 'Location (country, site)', status: 'planned' },
  { field: 'Pathway type',           status: 'planned' },
  { field: 'Annual capacity (kt/yr)', status: 'planned' },
  { field: 'Input material types',   status: 'planned' },
  { field: 'Status (operating / pilot / announced)', status: 'planned' },
  { field: 'Gate fee range',         status: 'planned' },
  { field: 'Coverage regions',       status: 'planned' },
]

function FacilityDirectory() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5 px-8 text-center">
      <div>
        <p className="text-[14px] font-semibold text-ink mb-2">Facility Directory</p>
        <p className="text-[12px] text-ink-3 max-w-md leading-relaxed">
          A structured directory of blade recycling and processing facilities globally.
          Each record covers capacity, pathway type, gate fees, and status.
        </p>
      </div>
      <div className="space-y-2 w-full max-w-sm text-left">
        {FACILITY_SIGNAL_ROWS.map(r => (
          <div key={r.field} className="flex items-center gap-2.5 px-3 py-2 bg-panel border border-border rounded text-[11.5px] text-ink-3">
            <span className="w-1.5 h-1.5 rounded-full bg-border flex-shrink-0" />
            {r.field}
          </div>
        ))}
      </div>
      <span className="text-[10px] font-semibold text-ink-4 uppercase tracking-widest bg-page border border-border px-3 py-1 rounded">
        Directory in build
      </span>
    </div>
  )
}

// ── 03 Gate Fees ──────────────────────────────────────────────────────────────

interface GateFeeRow {
  pathway:   string
  region:    string
  low:       string
  high:      string
  unit:      string
  note:      string
  source:    string
}

const GATE_FEE_TABLE: GateFeeRow[] = [
  { pathway: 'Cement co-processing', region: 'EU',  low: '€130', high: '€200', unit: '/t', note: 'Competitive due to volume. Fuel substitution credit may reduce net cost.', source: 'WindEurope / operator quotes' },
  { pathway: 'Cement co-processing', region: 'UK',  low: '£120', high: '£180', unit: '/t', note: 'UK cement plants accept GRP in select markets.', source: 'Industry estimate' },
  { pathway: 'Mechanical shredding', region: 'EU',  low: '€80',  high: '€150', unit: '/t', note: 'Cost-competitive but limited end-market for shred output.', source: 'Industry estimate' },
  { pathway: 'Mechanical shredding', region: 'US',  low: '$75',  high: '$130', unit: '/t', note: 'Global Fiberglass Solutions rates approximate.', source: 'GFS / operator quotes' },
  { pathway: 'Pyrolysis',            region: 'EU',  low: '€200', high: '€400', unit: '/t', note: 'Early commercial — pricing variable and not publicly disclosed.', source: 'Research / pilot estimates' },
  { pathway: 'Landfill',             region: 'US',  low: '$50',  high: '$120', unit: '/t', note: 'Still permitted in most US states. IL, CO have enacted bans.', source: 'State gate fee surveys' },
]

function GateFees() {
  const [pathwayRows, setPathwayRows] = useState<{ pathway: string; region: string; eur_per_tonne: number; basis: string | null }[]>([])
  const [region, setRegion] = useState<'EU'|'GB'|'US'>('EU')

  useEffect(() => {
    supabase.from('blade_gate_fees')
      .select('pathway, region, eur_per_tonne, basis')
      .then(({ data }) => setPathwayRows(((data ?? []) as { pathway: string; region: string; eur_per_tonne: number; basis: string | null }[])))
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Info strip */}
      <div className="px-5 py-2.5 border-b border-border bg-page text-[10.5px] text-ink-4 flex items-center gap-2 flex-shrink-0">
        <span className="text-teal">ⓘ</span>
        <span>
          Gate fees are indicative ranges from industry sources and operator quotes. Not contractual.
          Actual fees vary by volume, location, and blade condition. Updated quarterly.
        </span>
      </div>

      {/* Pathway comparison chart (Chart J) */}
      <div className="px-5 py-4 border-b border-border bg-page">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-ink-2">Pathway gate-fee comparison · {region}</p>
          <div className="flex items-center gap-1 bg-panel border border-border rounded p-0.5">
            {(['EU','GB','US'] as const).map(r => (
              <button key={r} onClick={() => setRegion(r)}
                      className={`px-2.5 py-1 text-[10px] font-semibold rounded transition-colors ${region === r ? 'bg-teal text-white' : 'text-ink-3 hover:text-ink'}`}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-panel border border-border rounded-lg p-3">
          <BladePathwayBars rows={pathwayRows} region={region} />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-border bg-page text-left sticky top-0">
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Pathway</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Region</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">Low</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider text-right">High</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Notes</th>
              <th className="px-5 py-2.5 font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {GATE_FEE_TABLE.map((row, i) => (
              <tr key={i} className="hover:bg-page transition-colors">
                <td className="px-5 py-3 font-semibold text-ink">{row.pathway}</td>
                <td className="px-5 py-3 text-ink-2">{row.region}</td>
                <td className="px-5 py-3 text-right font-semibold text-down tabular-nums">{row.low}<span className="font-normal text-ink-4 text-[10px]">{row.unit}</span></td>
                <td className="px-5 py-3 text-right font-semibold text-down tabular-nums">{row.high}<span className="font-normal text-ink-4 text-[10px]">{row.unit}</span></td>
                <td className="px-5 py-3 text-ink-3 max-w-xs text-[11px]">{row.note}</td>
                <td className="px-5 py-3 text-ink-4 text-[11px]">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Landfill ban tracker */}
        <div className="mx-5 my-5 max-w-2xl">
          <h3 className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest mb-3">
            Landfill ban tracker
          </h3>
          <div className="bg-panel border border-border rounded-lg overflow-hidden">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Jurisdiction</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Effective</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-ink-3 text-[10px] uppercase tracking-wider">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { jur: 'EU27',        status: 'Banned',    date: '2025', scope: 'All composite / GRP wind blade waste' },
                  { jur: 'Germany',     status: 'Banned',    date: '2021', scope: 'Preceded EU directive — national law' },
                  { jur: 'France',      status: 'Banned',    date: '2022', scope: 'Hazardous classification triggers ban' },
                  { jur: 'Netherlands', status: 'Banned',    date: '2023', scope: 'Strict GRP and composite landfill ban' },
                  { jur: 'UK',          status: 'Restricted', date: 'No formal ban', scope: 'High gate fees; government review ongoing' },
                  { jur: 'US (federal)', status: 'Permitted', date: '—', scope: 'State-level bans only (IL, CO, others proposed)' },
                  { jur: 'Illinois',    status: 'Banned',    date: '2024', scope: 'First US state landfill ban for wind blades' },
                  { jur: 'Colorado',    status: 'Banned',    date: '2023', scope: 'Composite wind blade landfill ban enacted' },
                ].map(r => (
                  <tr key={r.jur} className="hover:bg-page transition-colors">
                    <td className="px-4 py-2.5 font-semibold text-ink">{r.jur}</td>
                    <td className="px-4 py-2.5">
                      <span className={clsx(
                        'text-[9.5px] font-semibold px-1.5 py-px rounded border',
                        r.status === 'Banned'      ? 'bg-red-50 text-down border-red-200' :
                        r.status === 'Restricted'  ? 'bg-amber-50 text-amber-700 border-amber-200' :
                        'bg-page text-ink-3 border-border',
                      )}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-3">{r.date}</td>
                    <td className="px-4 py-2.5 text-ink-3 text-[11px]">{r.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 04 Capacity Signals ───────────────────────────────────────────────────────

function CapacitySignals() {
  const [events,   setEvents]   = useState<WatchEvent[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<WatchEvent | null>(null)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('watch_events')
      .select('id, headline, notes, event_type, scope, company_name, capacity_mw, event_date, confidence, source_url, watch_sources(name, url)')
      .eq('category', 'supply_chain')
      .eq('is_duplicate', false)
      .order('event_date', { ascending: false })
      .then(({ data }) => {
        setEvents((data as unknown as WatchEvent[]) ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Description strip */}
      <div className="px-5 py-2.5 border-b border-border bg-page text-[10.5px] text-ink-4 flex items-center gap-2 flex-shrink-0">
        <span className="text-teal">ⓘ</span>
        <span>
          Supply chain signals from the Market Watch feed — contractor news, recycler announcements,
          capacity additions, and facility status changes.
        </span>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto divide-y divide-border">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="px-5 py-4 animate-pulse space-y-2">
                <div className="h-3 bg-page rounded w-3/4" />
                <div className="h-3 bg-page rounded w-1/2" />
              </div>
            ))
          ) : events.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[12px] text-ink-3 mb-2">No supply chain signals yet.</p>
              <p className="text-[11.5px] text-ink-4 max-w-sm mx-auto">
                Run sync_airtable_watch.py with Contractor News, Recycler Announcement, and
                Capacity Signal records to populate this feed.
              </p>
            </div>
          ) : events.map(ev => {
            const isSelected = selected?.id === ev.id
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
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10.5px] text-ink-3">
                    {new Date(ev.event_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                  <span className="text-ink-4">·</span>
                  <span className="text-[11px] text-ink-3">{ev.event_type}</span>
                  <span className="text-ink-4">·</span>
                  <span className="text-[10.5px] text-ink-3">{SCOPE_LABEL[ev.scope] ?? ev.scope}</span>
                  <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                    <span className={clsx('text-[10.5px] font-semibold', CONFIDENCE_STYLE[ev.confidence])}>
                      {ev.confidence}
                    </span>
                    {ev.watch_sources?.name && (
                      <span className="text-[10.5px] text-ink-4 max-w-[140px] truncate">
                        {ev.watch_sources.name}
                      </span>
                    )}
                  </div>
                </div>
                <h3 className="text-[13px] font-semibold text-ink leading-snug mb-1.5">
                  {ev.headline}
                </h3>
                {ev.notes && (
                  <p className="text-[11.5px] text-ink-3 leading-relaxed line-clamp-2">{ev.notes}</p>
                )}
                {ev.company_name && (
                  <div className="flex items-center gap-1.5 mt-2">
                    <div className="w-1 h-1 rounded-full bg-border flex-shrink-0" />
                    <span className="text-[10.5px] text-ink-4">
                      {[ev.company_name, ev.capacity_mw != null ? `${ev.capacity_mw} MW` : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {selected && (
          <div className="w-72 flex-shrink-0 border-l border-border bg-panel flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-[11px] font-semibold text-ink">{selected.event_type}</span>
              <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-lg leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[11.5px]">
              <p className="font-semibold text-ink leading-snug">{selected.headline}</p>
              {selected.notes && (
                <p className="text-ink-2 leading-relaxed">{selected.notes}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Region',     value: SCOPE_LABEL[selected.scope] ?? selected.scope },
                  { label: 'Date',       value: fmtDate(selected.event_date) },
                  { label: 'Confidence', value: selected.confidence },
                  { label: 'Company',    value: selected.company_name ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">{label}</div>
                    <div className={clsx('font-medium text-ink-2', label === 'Confidence' ? CONFIDENCE_STYLE[value] : '')}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              {selected.watch_sources && (
                <div>
                  <div className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest mb-1">Source</div>
                  <div className="text-ink-2">{selected.watch_sources.name}</div>
                  {(selected.source_url || selected.watch_sources.url) && (
                    <a
                      href={selected.source_url ?? selected.watch_sources.url ?? ''}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[11px] text-teal hover:underline mt-1"
                    >
                      <ExternalLink size={10} /> View source
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BladesPage() {
  const [subTab, setSubTab] = useState<SubTab>('blades')

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
        {/* Coverage badges */}
        <div className="ml-auto flex items-center pr-5 gap-2">
          <span className="text-[9.5px] font-semibold text-ink-4 uppercase tracking-widest">Coverage</span>
          {['EU', 'GB', 'US'].map(s => (
            <span key={s} className="text-[9.5px] font-semibold px-1.5 py-px bg-page border border-border rounded text-ink-3">
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {subTab === 'blades'    && <CompositeBlades />}
        {subTab === 'directory' && <FacilityDirectory />}
        {subTab === 'fees'      && <GateFees />}
        {subTab === 'signals'   && <CapacitySignals />}
      </div>
    </div>
  )
}
