// ── Data Health Overlay ──────────────────────────────────────────────────────
// Triggered from BottomFooter "Coverage" button.
// Shows live data-freshness, source confidence breakdown, and ingestion runs.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface TableHealth {
  table:           string
  label:           string
  rows:            number
  latest_source:   string | null
  by_confidence:   { High: number; Medium: number; Low: number }
  by_derivation:   { Observed: number; Inferred: number; Modelled: number }
}

interface IngestionRun {
  id:                 string
  pipeline:           string
  status:             string
  started_at:         string
  finished_at:        string | null
  records_written:    number | null
  source_attribution: string | null
  notes:              string | null
  error_message:      string | null
}

const TRACKED_TABLES = [
  { table: 'assets',                      label: 'Asset registries' },
  { table: 'commodity_prices',            label: 'Commodity prices' },
  { table: 'turbine_material_profiles',   label: 'Turbine LCA profiles' },
  { table: 'nro_estimates',               label: 'NRO estimates' },
  { table: 'dci_publications',            label: 'DCI publications' },
  { table: 'fx_rates',                    label: 'FX rates' },
  { table: 'watch_events',                label: 'Watch events' },
  { table: 'repowering_projects',         label: 'Repowering projects' },
]

function fmtAge(iso: string | null): { label: string; tone: 'fresh' | 'stale' | 'old' } {
  if (!iso) return { label: '—', tone: 'old' }
  const d = new Date(iso); const days = Math.round((Date.now() - d.getTime()) / 86400000)
  if (days <= 7)  return { label: `${days}d ago`, tone: 'fresh' }
  if (days <= 30) return { label: `${days}d ago`, tone: 'stale' }
  return { label: `${days}d ago`, tone: 'old' }
}

export function DataHealthOverlay({ onClose }: { onClose: () => void }) {
  const [tables, setTables] = useState<TableHealth[]>([])
  const [runs,   setRuns]   = useState<IngestionRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      // For each tracked table, count rows + read most-recent source_date + confidence/derivation
      const results: TableHealth[] = []
      for (const t of TRACKED_TABLES) {
        try {
          // Total rows
          const cnt = await supabase.from(t.table).select('*', { count: 'exact', head: true })
          const rows = cnt.count ?? 0

          // Latest source_date (or publication_date / event_date)
          const dateCol =
            t.table === 'dci_publications'  ? 'publication_date' :
            t.table === 'watch_events'      ? 'event_date' :
            t.table === 'fx_rates'          ? 'rate_date' :
            t.table === 'commodity_prices'  ? 'price_date' :
            t.table === 'nro_estimates'     ? 'reference_date' :
            'source_date'

          let latest: string | null = null
          try {
            const lat = await supabase.from(t.table).select(dateCol).order(dateCol, { ascending: false }).limit(1)
            latest = (lat.data as Record<string, string>[] | null)?.[0]?.[dateCol] ?? null
          } catch { /* */ }

          // Confidence + derivation counts (not all tables have them)
          const conf = { High: 0, Medium: 0, Low: 0 }
          const der  = { Observed: 0, Inferred: 0, Modelled: 0 }
          if (['assets','commodity_prices','turbine_material_profiles','nro_estimates','watch_events','dci_publications','repowering_projects'].includes(t.table)) {
            try {
              const allConf = await supabase.from(t.table).select('confidence')
              for (const r of (allConf.data as { confidence: string }[] | null) ?? []) {
                if (r.confidence in conf) (conf as Record<string, number>)[r.confidence]++
              }
            } catch { /* */ }
            try {
              const allDer = await supabase.from(t.table).select('derivation')
              for (const r of (allDer.data as { derivation: string }[] | null) ?? []) {
                if (r.derivation in der) (der as Record<string, number>)[r.derivation]++
              }
            } catch { /* */ }
          }

          results.push({
            table: t.table, label: t.label, rows, latest_source: latest,
            by_confidence: conf, by_derivation: der,
          })
        } catch {
          results.push({
            table: t.table, label: t.label, rows: 0, latest_source: null,
            by_confidence: { High: 0, Medium: 0, Low: 0 },
            by_derivation: { Observed: 0, Inferred: 0, Modelled: 0 },
          })
        }
      }

      // Recent ingestion runs
      const runsRes = await supabase.from('ingestion_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20)

      if (alive) {
        setTables(results)
        setRuns((runsRes.data as IngestionRun[]) ?? [])
        setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6" onClick={onClose}>
      <div className="bg-page border border-border rounded-sm shadow-panel-float w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <header className="flex-shrink-0 px-2 py-1.5 border-b border-border flex items-center bg-panel">
          <div>
            <p className="text-[13px] font-bold tracking-widest text-ink-3 uppercase">DATA HEALTH</p>
            <h2 className="text-[13px] font-semibold text-ink">Coverage, freshness &amp; source confidence</h2>
          </div>
          <button onClick={onClose} className="ml-auto text-ink-3 hover:text-ink text-[18px] leading-none px-2">×</button>
        </header>

        <div className="flex-1 overflow-auto p-2 space-y-2">
          {loading ? (
            <div className="text-[13px] text-ink-3 text-center py-8">Loading…</div>
          ) : (
            <>
              {/* Coverage table */}
              <div className="bg-panel border border-border rounded-sm overflow-hidden">
                <div className="px-2 py-1.5 border-b border-border">
                  <p className="text-[13px] font-semibold text-ink-2">Table coverage</p>
                </div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-page">
                      <th className="px-2 py-1 text-left text-[13px] font-semibold text-ink-3 uppercase">Table</th>
                      <th className="px-2 py-1 text-right text-[13px] font-semibold text-ink-3 uppercase">Rows</th>
                      <th className="px-2 py-1 text-right text-[13px] font-semibold text-ink-3 uppercase">Latest</th>
                      <th className="px-2 py-1 text-right text-[13px] font-semibold text-ink-3 uppercase">Confidence (H/M/L)</th>
                      <th className="px-2 py-1 text-right text-[13px] font-semibold text-ink-3 uppercase">Derivation (Obs/Inf/Mod)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.map((t, i) => {
                      const age = fmtAge(t.latest_source)
                      return (
                        <tr key={t.table} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-canvas' : ''}`}>
                          <td className="px-4 py-2">
                            <div className="text-ink font-semibold">{t.label}</div>
                            <div className="text-[13px] text-ink-4">{t.table}</div>
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink">{t.rows.toLocaleString('en-GB')}</td>
                          <td className={`px-2 py-1 text-right tabular-nums text-[13px] font-semibold ${
                            age.tone === 'fresh' ? 'text-up' :
                            age.tone === 'stale' ? 'text-highlight' :
                            'text-down'
                          }`}>{age.label}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-[13px] text-ink-2">
                            {t.by_confidence.High + t.by_confidence.Medium + t.by_confidence.Low > 0
                              ? `${t.by_confidence.High} / ${t.by_confidence.Medium} / ${t.by_confidence.Low}`
                              : '—'}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-[13px] text-ink-2">
                            {t.by_derivation.Observed + t.by_derivation.Inferred + t.by_derivation.Modelled > 0
                              ? `${t.by_derivation.Observed} / ${t.by_derivation.Inferred} / ${t.by_derivation.Modelled}`
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Ingestion runs */}
              <div className="bg-panel border border-border rounded-sm overflow-hidden">
                <div className="px-2 py-1.5 border-b border-border">
                  <p className="text-[13px] font-semibold text-ink-2">Recent ingestion runs ({runs.length})</p>
                </div>
                {runs.length === 0 ? (
                  <p className="px-4 py-6 text-[13px] text-ink-3 text-center">No ingestion runs recorded yet. Runs are written by ingestion pipelines as they execute.</p>
                ) : (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border bg-page">
                        <th className="px-2 py-1 text-left text-[13px] font-semibold text-ink-3 uppercase">Pipeline</th>
                        <th className="px-2 py-1 text-left text-[13px] font-semibold text-ink-3 uppercase">Status</th>
                        <th className="px-2 py-1 text-left text-[13px] font-semibold text-ink-3 uppercase">Started</th>
                        <th className="px-2 py-1 text-right text-[13px] font-semibold text-ink-3 uppercase">Records</th>
                        <th className="px-2 py-1 text-left text-[13px] font-semibold text-ink-3 uppercase">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map((r, i) => (
                        <tr key={r.id} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-canvas' : ''}`}>
                          <td className="px-2 py-1 text-ink font-semibold">{r.pipeline}</td>
                          <td className={`px-2 py-1 text-[13px] font-semibold ${
                            r.status === 'success' ? 'text-up' :
                            r.status === 'partial' ? 'text-highlight' :
                            r.status === 'running' ? 'text-teal' :
                            'text-down'
                          }`}>{r.status}</td>
                          <td className="px-2 py-1 text-ink-2 text-[13px] tabular-nums">{new Date(r.started_at).toLocaleString('en-GB')}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-ink-2">{r.records_written?.toLocaleString('en-GB') ?? '—'}</td>
                          <td className="px-2 py-1 text-ink-3 text-[10px]">{r.error_message ? <span className="text-down">{r.error_message}</span> : (r.notes ?? '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Source attributions */}
              <div className="bg-page border border-border rounded-sm p-4">
                <p className="text-[13px] font-semibold text-ink-3 uppercase tracking-wide mb-3">Source attributions</p>
                <div className="grid grid-cols-2 gap-3 text-[13px] text-ink-2">
                  <div>• Bundesnetzagentur — Marktstammdatenregister (DL-DE-BY-2.0)</div>
                  <div>• BEIS — Renewable Energy Planning Database (OGL v3.0)</div>
                  <div>• USGS / DOE — US Wind Turbine Database (CC0)</div>
                  <div>• Energistyrelsen — Stamdataregister for vindkraftanlæg</div>
                  <div>• ODRÉ — Open Data Réseaux Énergies</div>
                  <div>• Global Energy Monitor — Wind Power Tracker (CC BY 4.0)</div>
                  <div>• LME — copper, aluminium settlement prices</div>
                  <div>• Fastmarkets — HMS1/HMS2 ferrous scrap (EU/UK)</div>
                  <div>• AMM — North America scrap reference prices</div>
                  <div>• ECB — daily EUR reference rates</div>
                  <div>• Argus — NdPr oxide rare earth pricing</div>
                  <div>• OEM LCAs — Vestas, Siemens Gamesa, GE, Nordex, Enercon</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
