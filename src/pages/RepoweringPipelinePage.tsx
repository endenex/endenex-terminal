import { useState, useEffect, useCallback } from 'react'
import { X, ExternalLink, ChevronRight, ChevronLeft, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { ResponsiveContainer, BarChart, Bar, XAxis, Cell, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { TopBar } from '@/components/layout/TopBar'
import type { TopBarMeta } from '@/components/layout/TopBar'
import type { RepoweringProject, RepoweringStage } from '@/lib/types'
import { SkeletonTableRow } from '@/components/ui/Skeleton'
import { useTableSort } from '@/hooks/useTableSort'
import { SortableTh } from '@/components/ui/SortableHeader'

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<RepoweringStage | 'all', string> = {
  all: 'All',
  announced: 'Announced',
  application_submitted: 'Application Submitted',
  application_approved: 'Application Approved',
  permitted: 'Permitted',
  ongoing: 'Ongoing',
}

const STAGE_ORDER: (RepoweringStage | 'all')[] = [
  'all',
  'announced',
  'application_submitted',
  'application_approved',
  'permitted',
  'ongoing',
]

const CONFIDENCE_COLOUR: Record<string, string> = {
  High: 'text-emerald-400',
  Medium: 'text-amber-400',
  Low: 'text-red-400',
}

const COUNTRIES = [
  { code: 'DE', label: 'Germany' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'US', label: 'United States' },
  { code: 'DK', label: 'Denmark' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
]

const PAGE_SIZE = 50

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(val: string | null): string {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
  } catch {
    return '—'
  }
}

function formatMW(val: number | null): string {
  if (val == null) return '—'
  return `${val.toLocaleString('en-GB', { maximumFractionDigits: 1 })} MW`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StagePill({ stage }: { stage: RepoweringStage }) {
  const colours: Record<RepoweringStage, string> = {
    announced: 'bg-sky-900/30 text-sky-400 border-sky-700/50',
    application_submitted: 'bg-violet-900/30 text-violet-400 border-violet-700/50',
    application_approved: 'bg-blue-900/30 text-blue-400 border-blue-700/50',
    permitted: 'bg-teal-900/30 text-teal-400 border-teal-700/50',
    ongoing: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/50',
  }
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 text-[10px] font-mono font-medium border rounded',
      colours[stage]
    )}>
      {STAGE_LABELS[stage]}
    </span>
  )
}

function CountryDropdown({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (codes: string[]) => void
}) {
  const [open, setOpen] = useState(false)

  const toggle = (code: string) => {
    onChange(
      selected.includes(code)
        ? selected.filter(c => c !== code)
        : [...selected, code]
    )
  }

  const label = selected.length === 0
    ? 'All Countries'
    : selected.length === 1
    ? COUNTRIES.find(c => c.code === selected[0])?.label ?? selected[0]
    : `${selected.length} countries`

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 bg-terminal-surface border border-terminal-border rounded text-xs text-terminal-muted hover:border-terminal-teal hover:text-terminal-text transition-colors min-w-[160px] font-mono"
      >
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={13} className="text-terminal-muted flex-shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-terminal-surface border border-terminal-border rounded shadow-xl min-w-[180px] py-1">
            {COUNTRIES.map(({ code, label: cLabel }) => (
              <label
                key={code}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-terminal-black cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  onChange={() => toggle(code)}
                  className="accent-teal-500 w-3.5 h-3.5"
                />
                <span className="text-xs text-terminal-muted">{cLabel}</span>
                <span className="ml-auto text-[10px] text-terminal-muted font-mono">{code}</span>
              </label>
            ))}
            {selected.length > 0 && (
              <div className="border-t border-terminal-border mt-1 pt-1 px-3 pb-1">
                <button
                  onClick={() => onChange([])}
                  className="text-xs text-terminal-muted hover:text-terminal-text"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DetailPanel({
  project,
  onClose,
}: {
  project: RepoweringProject
  onClose: () => void
}) {
  const rows: [string, string][] = [
    ['Stage', STAGE_LABELS[project.stage]],
    ['Stage date', formatDate(project.stage_date)],
    ['Country', COUNTRIES.find(c => c.code === project.country_code)?.label ?? project.country_code],
    ['Capacity', formatMW(project.capacity_mw)],
    ['Turbines', project.turbine_count != null ? String(project.turbine_count) : '—'],
    ['Turbine make', project.turbine_make ?? '—'],
    ['Turbine model', project.turbine_model ?? '—'],
    ['Hub height', project.hub_height_m != null ? `${project.hub_height_m} m` : '—'],
    ['Rotor diameter', project.rotor_diameter_m != null ? `${project.rotor_diameter_m} m` : '—'],
    ['Developer', project.developer ?? '—'],
    ['Operator', project.operator ?? '—'],
    ['Planning ref', project.planning_reference ?? '—'],
    ['Location', project.location_description ?? '—'],
  ]

  const metaRows: [string, string][] = [
    ['Source', project.source_type],
    ['Source date', formatDate(project.source_date)],
    ['Confidence', project.confidence],
    ['Derivation', project.derivation],
    ['Last reviewed', formatDate(project.last_reviewed)],
  ]

  return (
    <div className="w-80 flex-shrink-0 border-l border-terminal-border bg-terminal-surface flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-terminal-border">
        <div className="flex-1 min-w-0 pr-3">
          <div className="text-sm font-semibold text-terminal-text leading-snug">
            {project.project_name}
          </div>
          <div className="mt-1.5">
            <StagePill stage={project.stage} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-terminal-muted hover:text-terminal-text flex-shrink-0 mt-0.5"
        >
          <X size={15} />
        </button>
      </div>

      {/* Project details */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4">
          <div className="text-[10px] text-terminal-muted font-mono tracking-widest uppercase mb-3">
            Project Details
          </div>
          <div className="space-y-2.5">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-xs">
                <span className="text-terminal-muted flex-shrink-0">{label}</span>
                <span className="text-terminal-text font-mono text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {project.notes && (
          <div className="px-5 py-3 border-t border-terminal-border">
            <div className="text-[10px] text-terminal-muted font-mono tracking-widest uppercase mb-2">
              Notes
            </div>
            <p className="text-xs text-terminal-muted leading-relaxed">{project.notes}</p>
          </div>
        )}

        {/* Source metadata */}
        <div className="px-5 py-4 border-t border-terminal-border">
          <div className="text-[10px] text-terminal-muted font-mono tracking-widest uppercase mb-3">
            Source Metadata
          </div>
          <div className="space-y-2.5">
            {metaRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-xs">
                <span className="text-terminal-muted flex-shrink-0">{label}</span>
                <span
                  className={clsx(
                    'font-mono text-right',
                    label === 'Confidence'
                      ? CONFIDENCE_COLOUR[value] ?? 'text-terminal-text'
                      : 'text-terminal-text'
                  )}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {project.source_url && (
          <div className="px-5 pb-5">
            <a
              href={project.source_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-terminal-teal hover:underline"
            >
              <ExternalLink size={11} />
              View source
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ stage, countries }: { stage: RepoweringStage | 'all'; countries: string[] }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
      <div className="text-terminal-border text-4xl mb-4">◎</div>
      <div className="text-sm font-medium text-terminal-muted mb-1">No projects found</div>
      <div className="text-xs text-terminal-muted max-w-xs leading-relaxed">
        {stage !== 'all'
          ? `No ${STAGE_LABELS[stage].toLowerCase()} projects`
          : 'No repowering projects'}
        {countries.length > 0 ? ` in the selected markets` : ' across any market'}.
        {' '}Records are added as projects are identified and verified.
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function RepoweringPipelinePage() {
  const [stage, setStage] = useState<RepoweringStage | 'all'>('all')
  const [countries, setCountries] = useState<string[]>([])
  const [projects, setProjects] = useState<RepoweringProject[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<RepoweringProject | null>(null)
  const [topBarMeta, setTopBarMeta] = useState<TopBarMeta[]>([])
  const [stageCounts, setStageCounts] = useState<{ stage: string; count: number; label: string }[]>([])

  // One-time fetches: metadata + all stage counts for chart
  useEffect(() => {
    Promise.all([
      supabase.from('repowering_projects').select('last_reviewed, source_type').order('last_reviewed', { ascending: false }).limit(50),
      supabase.from('repowering_projects').select('stage'),
    ]).then(([metaRes, stageRes]) => {
      // TopBar metadata
      if (metaRes.data && metaRes.data.length > 0) {
        const latest  = metaRes.data[0].last_reviewed as string
        const sources = [...new Set((metaRes.data as { source_type: string }[]).map(r => r.source_type).filter(Boolean))]
        setTopBarMeta([
          { label: 'Source', value: sources.slice(0, 3).join(' · ') || '—' },
          { label: 'Last reviewed', value: formatDate(latest) },
        ])
      }
      // Stage bar chart counts
      const tally: Record<string, number> = {}
      for (const row of (stageRes.data ?? []) as { stage: string }[]) {
        tally[row.stage] = (tally[row.stage] ?? 0) + 1
      }
      const stageOrder: RepoweringStage[] = ['announced', 'application_submitted', 'application_approved', 'permitted', 'ongoing']
      setStageCounts(stageOrder.filter(s => tally[s] > 0).map(s => ({
        stage: s, count: tally[s], label: STAGE_LABELS[s],
      })))
    })
  }, [])

  const fetchProjects = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('repowering_projects')
        .select('*', { count: 'exact' })
        .order('stage_date', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

      if (stage !== 'all') q = q.eq('stage', stage)
      if (countries.length > 0) q = q.in('country_code', countries)

      const { data, count, error } = await q
      if (error) throw error
      setProjects(data ?? [])
      setTotal(count ?? 0)
    } catch (err) {
      console.error('Failed to load repowering projects', err)
      setProjects([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [stage, countries, page])

  useEffect(() => {
    setPage(0)
    setSelected(null)
  }, [stage, countries])

  const REFRESH_MS = 5 * 60 * 1000

  useEffect(() => {
    fetchProjects()
    const id = setInterval(fetchProjects, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchProjects])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  type ProjKey = 'project_name' | 'country_code' | 'capacity_mw' | 'developer' | 'stage' | 'stage_date' | 'confidence' | 'hub_height_m' | 'rotor_diameter_m'
  const { sorted: sortedProjects, sort, toggle } = useTableSort<RepoweringProject, ProjKey>(
    projects,
    (row, key) => row[key] as string | number | null,
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Repowering Pipeline"
        subtitle="Onshore wind repowering projects by pipeline stage"
        meta={topBarMeta}
      />

      {/* Stage tabs */}
      <div className="border-b border-terminal-border bg-terminal-surface px-6">
        <div className="flex items-center gap-0">
          {STAGE_ORDER.map(s => (
            <button
              key={s}
              onClick={() => setStage(s)}
              className={clsx(
                'px-4 py-3 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap',
                stage === s
                  ? 'border-terminal-teal text-terminal-teal'
                  : 'border-transparent text-terminal-muted hover:text-terminal-text'
              )}
            >
              {STAGE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Stage bar chart */}
      {stageCounts.length > 0 && (
        <div className="bg-terminal-black border-b border-terminal-border px-6 py-3 flex items-center gap-6">
          <span className="text-[10px] font-mono text-terminal-muted uppercase tracking-widest flex-shrink-0">
            Pipeline
          </span>
          <div className="flex-1 h-8">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stageCounts} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <Tooltip
                  cursor={false}
                  contentStyle={{
                    background: '#161B22', border: '1px solid #21262D',
                    borderRadius: 4, fontSize: 11, fontFamily: 'monospace',
                    color: '#E6EDF3', padding: '4px 8px',
                  }}
                  formatter={(v: number, _: string, entry: { payload: { label: string } }) =>
                    [`${v} projects`, entry.payload.label]
                  }
                />
                <Bar dataKey="count" radius={2} barSize={10} isAnimationActive={false}>
                  {stageCounts.map((_, i) => (
                    <Cell
                      key={i}
                      fill={['#38bdf8','#818cf8','#60a5fa','#2dd4bf','#34d399'][i % 5]}
                      fillOpacity={0.7}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {stageCounts.map(({ stage: s, count, label }) => (
              <span key={s} className="flex items-center gap-1 text-[10px] font-mono text-terminal-muted">
                <span className="num text-terminal-text">{count}</span> {label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-terminal-black border-b border-terminal-border px-6 py-2.5 flex items-center gap-4">
        <CountryDropdown selected={countries} onChange={setCountries} />
        <div className="ml-auto text-xs text-terminal-muted font-mono">
          {loading ? '—' : `${total.toLocaleString()} project${total !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <table className="w-full">
              <tbody>
                {Array.from({ length: 12 }).map((_, i) => <SkeletonTableRow key={i} cols={10} />)}
              </tbody>
            </table>
          ) : projects.length === 0 ? (
            <EmptyState stage={stage} countries={countries} />
          ) : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border bg-terminal-surface">
                    <SortableTh label="Project"    sortKey="project_name"     sort={sort} onSort={toggle} className="text-left pl-6 py-2.5 pr-3" />
                    <SortableTh label="Country"    sortKey="country_code"     sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Capacity"   sortKey="capacity_mw"      sort={sort} onSort={toggle} className="text-right py-2.5 pr-3" />
                    <th className="text-[10px] text-terminal-muted font-medium tracking-wide uppercase text-left py-2.5 pr-3">Turbine</th>
                    <SortableTh label="Hub Ht"     sortKey="hub_height_m"     sort={sort} onSort={toggle} className="text-right py-2.5 pr-3" />
                    <SortableTh label="Rotor"      sortKey="rotor_diameter_m" sort={sort} onSort={toggle} className="text-right py-2.5 pr-3" />
                    <SortableTh label="Developer"  sortKey="developer"        sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Stage"      sortKey="stage"            sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Stage Date" sortKey="stage_date"       sort={sort} onSort={toggle} className="text-left py-2.5 pr-3" />
                    <SortableTh label="Confidence" sortKey="confidence"       sort={sort} onSort={toggle} className="text-left py-2.5 pr-6" />
                  </tr>
                </thead>
                <tbody>
                  {sortedProjects.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => setSelected(sel => sel?.id === p.id ? null : p)}
                      className={clsx(
                        'border-b border-terminal-border cursor-pointer transition-colors',
                        selected?.id === p.id
                          ? 'bg-terminal-teal/10'
                          : 'hover:bg-terminal-surface'
                      )}
                    >
                      <td className="pl-6 py-3 pr-3 text-terminal-text font-medium max-w-[220px] truncate">
                        {p.project_name}
                      </td>
                      <td className="py-3 pr-3 text-terminal-muted">
                        {COUNTRIES.find(c => c.code === p.country_code)?.label ?? p.country_code}
                      </td>
                      <td className="py-3 pr-3 text-right text-terminal-text">
                        {p.capacity_mw != null
                          ? <><span className="num">{p.capacity_mw.toLocaleString('en-GB', { maximumFractionDigits: 1 })}</span><span className="unit">MW</span></>
                          : <span className="num text-terminal-muted">—</span>
                        }
                      </td>
                      <td className="py-3 pr-3 text-terminal-muted max-w-[160px] truncate font-mono text-xs">
                        {p.turbine_make && p.turbine_model
                          ? `${p.turbine_make} ${p.turbine_model}`
                          : p.turbine_model ?? p.turbine_make ?? '—'}
                      </td>
                      <td className="py-3 pr-3 text-right text-terminal-muted">
                        {p.hub_height_m != null
                          ? <><span className="num">{p.hub_height_m}</span><span className="unit">m</span></>
                          : <span className="num">—</span>
                        }
                      </td>
                      <td className="py-3 pr-3 text-right text-terminal-muted">
                        {p.rotor_diameter_m != null
                          ? <><span className="num">{p.rotor_diameter_m}</span><span className="unit">m</span></>
                          : <span className="num">—</span>
                        }
                      </td>
                      <td className="py-3 pr-3 text-terminal-muted max-w-[160px] truncate">
                        {p.developer ?? '—'}
                      </td>
                      <td className="py-3 pr-3">
                        <StagePill stage={p.stage} />
                      </td>
                      <td className="py-3 pr-3 font-mono text-terminal-muted">
                        {formatDate(p.stage_date)}
                      </td>
                      <td className="py-3 pr-6">
                        <span className={clsx('font-mono', CONFIDENCE_COLOUR[p.confidence])}>
                          {p.confidence}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-terminal-border bg-terminal-surface">
                  <span className="text-xs text-terminal-muted font-mono">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1.5 rounded text-terminal-muted hover:text-terminal-text disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs text-terminal-muted font-mono px-2">
                      {page + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page === totalPages - 1}
                      className="p-1.5 rounded text-terminal-muted hover:text-terminal-text disabled:opacity-30 transition-colors"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel project={selected} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  )
}
