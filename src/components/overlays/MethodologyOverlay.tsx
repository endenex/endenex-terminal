// ── Methodology Overlay ──────────────────────────────────────────────────────
// Triggered from BottomFooter "Methodology" button.
// Surfaces live DCI methodology version with formula, reference asset,
// vintage-bucketed LCA, three-layer recovery, country multipliers, and blade
// disposal pathways.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface MethodologyVersion {
  version:                     string
  effective_from:              string
  effective_to:                string | null
  reference_vintage:           number
  reference_capacity_mw:       number
  reference_turbine:           string
  reference_design_life:       number
  base_period_date:            string
  base_gross_cost_eur_mw:      number
  base_blade_transport_eur_mw: number
  base_blade_gate_fees_eur_mw: number
  base_scrap_haulage_eur_mw:   number
  cost_inflation_pct_yr:       number
  formula_summary:             string
  source_attributions:         string[] | null
}

interface VintageLcaRow {
  vintage:       'pre2005' | 'y2005' | 'y2010' | 'y2015'
  scope:         'full' | 'repowering'
  material:      string
  volume_per_mw: number
}

interface MetallurgicalRow {
  material: string
  rate:     number
  pathway:  string
}

interface ContaminationRow {
  material_class: string
  region:         string
  yield_rate:     number
}

interface BrokerRow {
  region:         string
  margin_low:     number
  margin_default: number
  margin_high:    number
}

interface GrossCostRow {
  component_id:    string
  label:           string
  category:        string
  base_rate_eur_mw: number
}

interface CountryMultRow {
  country_code: string
  country_name: string
  labour_mult:  number
  plant_mult:   number
  haul_mult:    number
  gate_mult:    number
}

interface BladePathwayRow {
  pathway:       string
  region:        string
  eur_per_tonne: number
  basis:         string
}

const VINTAGE_LABEL: Record<string, string> = {
  pre2005: 'pre-2005',
  y2005:   '2005–09',
  y2010:   '2010–14',
  y2015:   '2015+',
}

type Tab = 'formula' | 'lca' | 'recovery' | 'cost' | 'disposal' | 'sources'

export function MethodologyOverlay({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState<MethodologyVersion | null>(null)
  const [lca, setLca]                 = useState<VintageLcaRow[]>([])
  const [metallurgical, setMetallurgical] = useState<MetallurgicalRow[]>([])
  const [contamination, setContamination] = useState<ContaminationRow[]>([])
  const [broker, setBroker]           = useState<BrokerRow[]>([])
  const [grossCost, setGrossCost]     = useState<GrossCostRow[]>([])
  const [countryMults, setCountryMults] = useState<CountryMultRow[]>([])
  const [bladePathways, setBladePathways] = useState<BladePathwayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('formula')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [vRes, lcaRes, mRes, cRes, bRes, gRes, ccRes, bpRes] = await Promise.all([
          supabase.from('dci_methodology_versions').select('*').order('effective_from', { ascending: false }).limit(1).single(),
          supabase.from('wind_material_intensities').select('vintage, scope, material, volume_per_mw').order('vintage').order('scope').order('material'),
          supabase.from('metallurgical_recovery_rates').select('material, rate, pathway').order('material'),
          supabase.from('merchant_contamination_yields').select('material_class, region, yield_rate'),
          supabase.from('broker_margins').select('region, margin_low, margin_default, margin_high').order('region'),
          supabase.from('dci_gross_cost_components').select('component_id, label, category, base_rate_eur_mw').order('base_rate_eur_mw', { ascending: false }),
          supabase.from('country_cost_multipliers').select('country_code, country_name, labour_mult, plant_mult, haul_mult, gate_mult').order('country_code'),
          supabase.from('blade_gate_fees').select('pathway, region, eur_per_tonne, basis').order('eur_per_tonne'),
        ])
        if (!alive) return
        setV((vRes.data as MethodologyVersion) ?? null)
        setLca((lcaRes.data ?? []) as VintageLcaRow[])
        setMetallurgical((mRes.data ?? []) as MetallurgicalRow[])
        setContamination((cRes.data ?? []) as ContaminationRow[])
        setBroker((bRes.data ?? []) as BrokerRow[])
        setGrossCost((gRes.data ?? []) as GrossCostRow[])
        setCountryMults((ccRes.data ?? []) as CountryMultRow[])
        setBladePathways((bpRes.data ?? []) as BladePathwayRow[])
      } catch { /* */ }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // Vintage LCA pivoted: rows = material, cols = vintage (full scope only for the headline view)
  const lcaFull = lca.filter(r => r.scope === 'full')
  const materials = Array.from(new Set(lcaFull.map(r => r.material)))
  const lcaMap = new Map<string, number>()
  for (const r of lcaFull) lcaMap.set(`${r.material}|${r.vintage}`, r.volume_per_mw)

  const grossSum = grossCost.reduce((s, r) => s + Number(r.base_rate_eur_mw), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6" onClick={onClose}>
      <div className="bg-page border border-border rounded-lg shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <header className="flex-shrink-0 px-5 py-4 border-b border-border bg-panel flex items-center">
          <div>
            <p className="text-[11px] font-bold tracking-widest text-ink-3 uppercase">METHODOLOGY</p>
            <h2 className="text-[15px] font-semibold text-ink">DCI Spot{v ? ` v${v.version}` : ''}</h2>
          </div>
          <button onClick={onClose} className="ml-auto text-ink-3 hover:text-ink text-[18px] leading-none px-2">×</button>
        </header>

        {/* Sub-tabs */}
        <div className="flex-shrink-0 flex items-center gap-0 border-b border-border bg-panel px-5 overflow-x-auto">
          {([
            ['formula',   'Formula & Reference'],
            ['lca',       'LCA Intensities'],
            ['recovery',  'Recovery Layers'],
            ['cost',      'Gross Cost & Multipliers'],
            ['disposal',  'Blade Disposal'],
            ['sources',   'Sources'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-shrink-0 px-3 py-2.5 text-[11px] font-semibold tracking-wide border-b-2 transition-colors ${
                tab === id ? 'border-teal text-teal' : 'border-transparent text-ink-3 hover:text-ink-2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          {loading ? (
            <div className="text-[12px] text-ink-3 text-center py-8">Loading…</div>
          ) : !v ? (
            <div className="text-[12px] text-ink-3 text-center py-8">No methodology version found. Run migrations 010–017.</div>
          ) : (

            <>
              {/* ── Formula & Reference ─────────────────────────────────── */}
              {tab === 'formula' && (
                <>
                  <section className="bg-panel border border-border rounded-lg p-4">
                    <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-2">Formula</p>
                    <pre className="text-[11px] text-ink font-mono bg-page border border-border rounded p-3 whitespace-pre-wrap">DCI Spot(t) = (Gross Cost(t) − Material Recovery(t) + Disposal Costs(t))
              / Net Liability(base) × 100</pre>
                    <p className="text-[11px] text-ink-2 mt-3 leading-relaxed">{v.formula_summary}</p>
                  </section>

                  <div className="grid grid-cols-2 gap-4">
                    <section className="bg-panel border border-border rounded-lg p-4">
                      <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-2">Reference asset</p>
                      <dl className="text-[11px] text-ink-2 space-y-1">
                        <div className="flex justify-between"><dt>Turbine</dt><dd className="text-ink font-semibold">{v.reference_turbine}</dd></div>
                        <div className="flex justify-between"><dt>Vintage</dt><dd>{v.reference_vintage}</dd></div>
                        <div className="flex justify-between"><dt>Capacity</dt><dd>{v.reference_capacity_mw} MW</dd></div>
                        <div className="flex justify-between"><dt>Design life</dt><dd>{v.reference_design_life} yr</dd></div>
                        <div className="flex justify-between"><dt>Base period</dt><dd>{v.base_period_date}</dd></div>
                      </dl>
                    </section>

                    <section className="bg-panel border border-border rounded-lg p-4">
                      <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-2">Series construction</p>
                      <table className="w-full text-[11px]">
                        <thead><tr className="border-b border-border"><th className="text-left py-1 font-semibold text-ink-3">Series</th><th className="text-left py-1 font-semibold text-ink-3">Currency</th><th className="text-left py-1 font-semibold text-ink-3">Anchor</th></tr></thead>
                        <tbody>
                          <tr className="border-b border-border"><td className="py-1.5">dci_wind_europe</td><td>EUR</td><td>EU + UK · DE multipliers anchor</td></tr>
                          <tr className="border-b border-border"><td className="py-1.5">dci_wind_north_america</td><td>USD</td><td>US + CA · US multipliers anchor</td></tr>
                          <tr className="border-b border-border"><td className="py-1.5">dci_solar_europe</td><td>EUR</td><td>Phase 2 — solar methodology in development</td></tr>
                          <tr className="border-b border-border"><td className="py-1.5">dci_solar_north_america</td><td>USD</td><td>Phase 2 — solar methodology in development</td></tr>
                          <tr><td className="py-1.5">dci_solar_japan</td><td>JPY</td><td>Phase 2 — solar methodology in development</td></tr>
                        </tbody>
                      </table>
                    </section>
                  </div>

                  <p className="text-[10px] text-ink-4 italic">
                    Effective from {v.effective_from}{v.effective_to ? ` to ${v.effective_to}` : ' (current)'} ·
                    Base inflation {v.cost_inflation_pct_yr}%/yr
                  </p>
                </>
              )}

              {/* ── LCA Intensities ─────────────────────────────────────── */}
              {tab === 'lca' && (
                <section className="bg-panel border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-ink-2">Wind material intensities — full scope (t/MW)</p>
                    <p className="text-[10px] text-ink-4">{lcaFull.length} rows · {materials.length} materials × 4 vintages</p>
                  </div>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-page">
                        <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Material</th>
                        {(['pre2005','y2005','y2010','y2015'] as const).map(v => (
                          <th key={v} className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">{VINTAGE_LABEL[v]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {materials.map((m, i) => (
                        <tr key={m} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                          <td className="px-4 py-2 font-semibold text-ink capitalize">{m}</td>
                          {(['pre2005','y2005','y2010','y2015'] as const).map(vv => {
                            const val = lcaMap.get(`${m}|${vv}`)
                            return (
                              <td key={vv} className="px-4 py-2 text-right tabular-nums text-ink-2">
                                {val != null ? val.toFixed(1) : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-3 text-[10px] text-ink-4 border-t border-border">
                    Repowering scope (turbine only, no inter-turbine cabling) is also stored — copper drops by ~30% vs full scope.
                  </p>
                </section>
              )}

              {/* ── Recovery Layers ─────────────────────────────────────── */}
              {tab === 'recovery' && (
                <>
                  <section className="bg-panel border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-[11px] font-semibold text-ink-2">Layer 1 · Metallurgical recovery rates (physics)</p>
                    </div>
                    <table className="w-full text-[12px]">
                      <thead><tr className="border-b border-border bg-page"><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Material</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Rate</th><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Pathway</th></tr></thead>
                      <tbody>
                        {metallurgical.map((r, i) => (
                          <tr key={r.material} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                            <td className="px-4 py-2 text-ink capitalize">{r.material}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink font-semibold">{(r.rate * 100).toFixed(0)}%</td>
                            <td className="px-4 py-2 text-ink-3 text-[11px]">{r.pathway}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  <div className="grid grid-cols-2 gap-4">
                    <section className="bg-panel border border-border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b border-border">
                        <p className="text-[11px] font-semibold text-ink-2">Layer 2 · Merchant contamination yield</p>
                      </div>
                      <table className="w-full text-[12px]">
                        <thead><tr className="border-b border-border bg-page"><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Class</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Yield</th></tr></thead>
                        <tbody>
                          {contamination.map((r, i) => (
                            <tr key={`${r.material_class}-${r.region}`} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                              <td className="px-4 py-2 text-ink">{r.material_class.replace(/_/g, ' ')}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-ink font-semibold">{(r.yield_rate * 100).toFixed(0)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="px-4 py-3 text-[10px] text-ink-4 border-t border-border">
                        Haul tonnage × yield = sold tonnage. 12% loss to contamination, paint, concrete debris.
                      </p>
                    </section>

                    <section className="bg-panel border border-border rounded-lg overflow-hidden">
                      <div className="px-4 py-3 border-b border-border">
                        <p className="text-[11px] font-semibold text-ink-2">Layer 3 · Broker margin (% deduction)</p>
                      </div>
                      <table className="w-full text-[12px]">
                        <thead><tr className="border-b border-border bg-page"><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Region</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Low</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Default</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">High</th></tr></thead>
                        <tbody>
                          {broker.map((r, i) => (
                            <tr key={r.region} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                              <td className="px-4 py-2 text-ink">{r.region}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-ink-2">{(r.margin_low * 100).toFixed(0)}%</td>
                              <td className="px-4 py-2 text-right tabular-nums text-ink font-semibold">{(r.margin_default * 100).toFixed(0)}%</td>
                              <td className="px-4 py-2 text-right tabular-nums text-ink-2">{(r.margin_high * 100).toFixed(0)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="px-4 py-3 text-[10px] text-ink-4 border-t border-border">
                        Net to operator = scrap price × (1 − broker margin) × sold tonnage.
                      </p>
                    </section>
                  </div>
                </>
              )}

              {/* ── Gross Cost & Multipliers ────────────────────────────── */}
              {tab === 'cost' && (
                <>
                  <section className="bg-panel border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-ink-2">Gross cost rate card · 8 work categories (UK baseline, EUR/MW)</p>
                      <p className="text-[11px] text-ink-3 tabular-nums">Total: <span className="font-semibold text-ink">€{grossSum.toLocaleString('en-GB')}/MW</span></p>
                    </div>
                    <table className="w-full text-[12px]">
                      <thead><tr className="border-b border-border bg-page"><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Component</th><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Category</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">EUR/MW</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">% Total</th></tr></thead>
                      <tbody>
                        {grossCost.map((r, i) => (
                          <tr key={r.component_id} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                            <td className="px-4 py-2 text-ink font-semibold">{r.label}</td>
                            <td className="px-4 py-2 text-ink-3 text-[11px] capitalize">{r.category}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink">€{Number(r.base_rate_eur_mw).toLocaleString('en-GB')}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink-3">{((Number(r.base_rate_eur_mw) / grossSum) * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  <section className="bg-panel border border-border rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <p className="text-[11px] font-semibold text-ink-2">Country cost multipliers (UK = 1.00 baseline)</p>
                    </div>
                    <table className="w-full text-[12px]">
                      <thead><tr className="border-b border-border bg-page"><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Country</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Labour</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Plant</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Haul</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Gate</th></tr></thead>
                      <tbody>
                        {countryMults.map((r, i) => (
                          <tr key={r.country_code} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                            <td className="px-4 py-2 text-ink"><span className="font-semibold">{r.country_code}</span> <span className="text-ink-3 text-[11px]">{r.country_name}</span></td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Number(r.labour_mult).toFixed(2)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Number(r.plant_mult).toFixed(2)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Number(r.haul_mult).toFixed(2)}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Number(r.gate_mult).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </>
              )}

              {/* ── Blade Disposal ──────────────────────────────────────── */}
              {tab === 'disposal' && (
                <section className="bg-panel border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-[11px] font-semibold text-ink-2">Blade gate fees by pathway (EUR/tonne)</p>
                  </div>
                  <table className="w-full text-[12px]">
                    <thead><tr className="border-b border-border bg-page"><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Pathway</th><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Region</th><th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">EUR/tonne</th><th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Basis</th></tr></thead>
                    <tbody>
                      {bladePathways.map((r, i) => (
                        <tr key={`${r.pathway}-${r.region}`} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                          <td className="px-4 py-2 text-ink font-semibold capitalize">{r.pathway.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-2 text-ink-2">{r.region}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink">€{Number(r.eur_per_tonne).toLocaleString('en-GB')}</td>
                          <td className="px-4 py-2 text-ink-3 text-[11px]">{r.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-3 text-[10px] text-ink-4 border-t border-border">
                    Pyrolysis is highest-cost; cement co-processing (Holcim/Neocomp) is the dominant commercial pathway in the EU. UK landfill includes the £130.75/t landfill tax (from 1 April 2026).
                  </p>
                </section>
              )}

              {/* ── Sources ─────────────────────────────────────────────── */}
              {tab === 'sources' && v.source_attributions && (
                <section className="bg-panel border border-border rounded-lg p-4">
                  <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-3">{v.source_attributions.length} source attributions</p>
                  <ul className="text-[11px] text-ink-2 space-y-1 columns-1">
                    {v.source_attributions.map((s, i) => <li key={i}>• {s}</li>)}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
