import { useState, useEffect, useCallback } from 'react'
import { X, ExternalLink, ChevronRight, ChevronLeft, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import { TopBar } from '@/components/layout/TopBar'
import type { RepoweringProject, RepoweringStage } from '@/lib/types'

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
  High: 'text-emerald-600',
  Medium: 'text-amber-600',
  Low: 'text-red-500',
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
    announced: 'bg-sky-50 text-sky-700 border-sky-200',
    application_submitted: 'bg-violet-50 text-violet-700 border-violet-200',
    application_approved: 'bg-blue-50 text-blue-700 border-blue-200',
    permitted: 'bg-teal-50 text-teal-700 border-teal-200',
    ongoing: 'bg-emerald-50 text-emerald-700 border-emerald-200',
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
        className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded text-sm text-gray-700 hover:border-gray-300 transition-colors min-w-[160px]"
      >
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded shadow-lg min-w-[180px] py-1">
            {COUNTRIES.map(({ code, label: cLabel }) => (
              <label
                key={code}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(code)}
                  onChange={() => toggle(code)}
                  className="accent-teal-600 w-3.5 h-3.5"
                />
                <span className="text-sm text-gray-700">{cLabel}</span>
                <span className="ml-auto text-[10px] text-gray-400 font-mono">{code}</span>
              </label>
            ))}
            {selected.length > 0 && (
              <div className="border-t border-gray-100 mt-1 pt-1 px-3 pb-1">
                <button
                  onClick={() => onChange([])}
                  className="text-xs text-gray-400 hover:text-gray-600"
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
    <div className="w-80 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex-1 min-w-0 pr-3">
          <div className="text-sm font-semibold text-gray-900 leading-snug">
            {project.project_name}
          </div>
          <div className="mt-1.5">
            <StagePill stage={project.stage} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
        >
          <X size={15} />
        </button>
      </div>

      {/* Project details */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4">
          <div className="text-[10px] text-gray-400 font-mono tracking-widest uppercase mb-3">
            Project Details
          </div>
          <div className="space-y-2.5">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-xs">
                <span className="text-gray-400 flex-shrink-0">{label}</span>
                <span className="text-gray-900 font-mono text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {project.notes && (
          <div className="px-5 py-3 border-t border-gray-100">
            <div className="text-[10px] text-gray-400 font-mono tracking-widest uppercase mb-2">
              Notes
            </div>
            <p className="text-xs text-gray-600 leading-relaxed">{project.notes}</p>
          </div>
        )}

        {/* Source metadata */}
        <div className="px-5 py-4 border-t border-gray-100">
          <div className="text-[10px] text-gray-400 font-mono tracking-widest uppercase mb-3">
            Source Metadata
          </div>
          <div className="space-y-2.5">
            {metaRows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 text-xs">
                <span className="text-gray-400 flex-shrink-0">{label}</span>
                <span
                  className={clsx(
                    'font-mono text-right',
                    label === 'Confidence'
                      ? CONFIDENCE_COLOUR[value] ?? 'text-gray-900'
                      : 'text-gray-900'
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
      <div className="text-gray-300 text-4xl mb-4">◎</div>
      <div className="text-sm font-medium text-gray-500 mb-1">No projects found</div>
      <div className="text-xs text-gray-400 max-w-xs leading-relaxed">
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

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <TopBar
        title="Repowering Pipeline"
        subtitle="Onshore wind repowering projects by pipeline stage"
      />

      {/* Stage tabs */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex items-center gap-0">
          {STAGE_ORDER.map(s => (
            <button
              key={s}
              onClick={() => setStage(s)}
              className={clsx(
                'px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap',
                stage === s
                  ? 'border-terminal-teal text-terminal-teal'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              )}
            >
              {STAGE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-4">
        <CountryDropdown selected={countries} onChange={setCountries} />
        <div className="ml-auto text-xs text-gray-400 font-mono">
          {loading ? '—' : `${total.toLocaleString()} project${total !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Table */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <div className="text-xs text-gray-400 font-mono">Loading…</div>
            </div>
          ) : projects.length === 0 ? (
            <EmptyState stage={stage} countries={countries} />
          ) : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    {[
                      ['Project', 'text-left pl-6 py-2.5 pr-3'],
                      ['Country', 'text-left py-2.5 pr-3'],
                      ['Capacity', 'text-right py-2.5 pr-3 font-mono'],
                      ['Turbine', 'text-left py-2.5 pr-3'],
                      ['Hub Ht (m)', 'text-right py-2.5 pr-3 font-mono'],
                      ['Rotor (m)', 'text-right py-2.5 pr-3 font-mono'],
                      ['Developer', 'text-left py-2.5 pr-3'],
                      ['Stage', 'text-left py-2.5 pr-3'],
                      ['Stage Date', 'text-left py-2.5 pr-3 font-mono'],
                      ['Confidence', 'text-left py-2.5 pr-6'],
                    ].map(([label, cls]) => (
                      <th key={label} className={clsx('text-[10px] text-gray-400 font-medium tracking-wide uppercase', cls)}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => setSelected(sel => sel?.id === p.id ? null : p)}
                      className={clsx(
                        'border-b border-gray-100 cursor-pointer transition-colors',
                        selected?.id === p.id
                          ? 'bg-teal-50'
                          : 'hover:bg-gray-50'
                      )}
                    >
                      <td className="pl-6 py-3 pr-3 text-gray-900 font-medium max-w-[220px] truncate">
                        {p.project_name}
                      </td>
                      <td className="py-3 pr-3 text-gray-600">
                        {COUNTRIES.find(c => c.code === p.country_code)?.label ?? p.country_code}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-gray-700">
                        {formatMW(p.capacity_mw)}
                      </td>
                      <td className="py-3 pr-3 text-gray-600 max-w-[160px] truncate font-mono text-xs">
                        {p.turbine_make && p.turbine_model
                          ? `${p.turbine_make} ${p.turbine_model}`
                          : p.turbine_model ?? p.turbine_make ?? '—'}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-gray-600">
                        {p.hub_height_m != null ? p.hub_height_m : '—'}
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-gray-600">
                        {p.rotor_diameter_m != null ? p.rotor_diameter_m : '—'}
                      </td>
                      <td className="py-3 pr-3 text-gray-600 max-w-[160px] truncate">
                        {p.developer ?? '—'}
                      </td>
                      <td className="py-3 pr-3">
                        <StagePill stage={p.stage} />
                      </td>
                      <td className="py-3 pr-3 font-mono text-gray-500">
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
                <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-white">
                  <span className="text-xs text-gray-400 font-mono">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs text-gray-500 font-mono px-2">
                      {page + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page === totalPages - 1}
                      className="p-1.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors"
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
