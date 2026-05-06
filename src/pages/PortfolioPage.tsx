// ── Portfolio Analytics — Tab 06 ─────────────────────────────────────────────
// 8 panels in a 12-col grid (no full-width content):
//   Row 1: Portfolio Assets table (col-8) + Summary cards (col-4)
//   Row 2: Liability Model (col-7) + NRO Attribution donut (col-5)
//   Row 3: IFRS Schedule (col-7) + Sensitivity sliders (col-5)
//   Row 4: Investor Pack exports (col-7) + Add Site / CSV import (col-5)

import { useState, useEffect, useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import type { PortfolioAsset, AssetClass } from '@/types/portfolio'
import {
  valueAsset, rollupPortfolio, routeCountry,
  type DciSnapshot, type FxRate, type NroSnapshot, type TurbineLcaRow,
  type CountryMultipliers,
  type AssetValuation, type PortfolioRollup,
} from '@/lib/portfolio-engine'
import {
  ifrsScheduleCsv, suretyPackCsv, boardMemoHtml, methodologyMd,
  toCsv, downloadCsv,
} from '@/lib/portfolio-export'
import { MaterialDonut, type DonutSlice } from '@/components/charts/MaterialDonut'

// ── Local types ──────────────────────────────────────────────────────────────

type ReportingCcy = 'EUR' | 'USD' | 'GBP'

const STORAGE_KEY = 'endenex_portfolio_v1'

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  onshore_wind:  'Onshore',
  offshore_wind: 'Offshore',
  solar_pv:      'Solar PV',
  bess:          'BESS',
}

const COUNTRIES = [
  'DE','GB','FR','ES','IT','NL','PL','DK','SE','NO','FI','PT','BE','AT','IE',
  'US','JP','AU','CA',
]

const TURBINE_PRESETS = [
  { make: 'Vestas',         model: 'V90-2.0' },
  { make: 'Siemens Gamesa', model: 'SG 2.5-114' },
  { make: 'GE',             model: '1.5sle' },
  { make: 'Nordex',         model: 'N117-2.4' },
  { make: 'Enercon',        model: 'E-82 E2' },
]

const BLANK_ASSET: Omit<PortfolioAsset, 'id'> = {
  site_name:          '',
  country_code:       'DE',
  asset_class:        'onshore_wind',
  capacity_mw:        0,
  turbine_count:      null,
  commissioning_year: 2010,
  operator:           '',
  notes:              '',
  turbine_make:       null,
  turbine_model:      null,
}

const CCY_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

function loadPortfolio(): PortfolioAsset[] {
  try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : [] }
  catch { return [] }
}
function savePortfolio(assets: PortfolioAsset[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(assets)) } catch { /* */ }
}

function fmtMw(mw: number) { return mw >= 1000 ? `${(mw / 1000).toFixed(1)} GW` : `${mw.toFixed(0)} MW` }

function fmt(n: number | null | undefined, sym = '€'): string {
  if (n == null || isNaN(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000_000) return `${sym}${(n / 1_000_000_000).toFixed(2)}bn`
  if (a >= 1_000_000)     return `${sym}${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000)         return `${sym}${(n / 1_000).toFixed(0)}k`
  return `${sym}${n.toFixed(0)}`
}

function loadSampleAssets(): Omit<PortfolioAsset, 'id'>[] {
  return [
    { site_name: 'North Hoyle',         country_code: 'GB', asset_class: 'offshore_wind', capacity_mw: 60,  turbine_count: 30, commissioning_year: 2003, operator: 'Innogy',     notes: '', turbine_make: 'Vestas',         turbine_model: 'V90-2.0' },
    { site_name: 'Brandenburg Cluster', country_code: 'DE', asset_class: 'onshore_wind',  capacity_mw: 24,  turbine_count: 12, commissioning_year: 2002, operator: 'EnBW',        notes: '', turbine_make: 'Enercon',        turbine_model: 'E-82 E2' },
    { site_name: 'Whitelee',            country_code: 'GB', asset_class: 'onshore_wind',  capacity_mw: 322, turbine_count: 215, commissioning_year: 2009, operator: 'ScottishPower', notes: '', turbine_make: 'Siemens Gamesa', turbine_model: 'SG 2.5-114' },
    { site_name: 'Roscoe Wind Farm',    country_code: 'US', asset_class: 'onshore_wind',  capacity_mw: 781, turbine_count: 627, commissioning_year: 2009, operator: 'E.ON',        notes: '', turbine_make: 'Siemens Gamesa', turbine_model: 'SG 2.5-114' },
    { site_name: 'Horns Rev 1',         country_code: 'DK', asset_class: 'offshore_wind', capacity_mw: 160, turbine_count: 80, commissioning_year: 2002, operator: 'Vattenfall',  notes: '', turbine_make: 'Vestas',         turbine_model: 'V90-2.0' },
    { site_name: 'Saint-Brieuc',        country_code: 'FR', asset_class: 'offshore_wind', capacity_mw: 496, turbine_count: 62, commissioning_year: 2023, operator: 'Iberdrola',   notes: '', turbine_make: 'Siemens Gamesa', turbine_model: 'SG 2.5-114' },
  ]
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
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}

// ── 01 Portfolio Assets panel ─────────────────────────────────────────────────

function AssetsPanel({
  assets, onUpdate, onDelete,
}: {
  assets: PortfolioAsset[]
  onUpdate: (id: string, a: Omit<PortfolioAsset, 'id'>) => void
  onDelete: (id: string) => void
}) {
  const [editId, setEditId]     = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  return (
    <Panel label="PORTFOLIO" title="Assets" className="col-span-8"
           meta={<span className="text-[10.5px] text-ink-4 tabular-nums">{assets.length} sites</span>}>
      {assets.length === 0 ? (
        <div className="px-3 py-6 text-center">
          <p className="text-[12.5px] text-ink-3 mb-1">No sites in your portfolio</p>
          <p className="text-[11.5px] text-ink-4">Add a site, import via CSV, or load the sample portfolio (right panel)</p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="bg-titlebar border-b border-border sticky top-0 z-10">
              <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Site</th>
              <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Country</th>
              <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Class</th>
              <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">MW</th>
              <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Comm.</th>
              <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Turbine</th>
              <th className="px-2.5 py-1 text-left text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide">Operator</th>
              <th className="px-2.5 py-1 text-right text-[10.5px] font-semibold text-ink-3 uppercase tracking-wide w-20"></th>
            </tr>
          </thead>
          <tbody>
            {assets.map(a => (
              <tr key={a.id} className="border-b border-border/70 hover:bg-raised">
                <td className="px-2.5 py-1 text-[12px] text-ink font-semibold truncate max-w-[180px]">{a.site_name}</td>
                <td className="px-2.5 py-1 text-[11.5px] text-ink-2">{a.country_code}</td>
                <td className="px-2.5 py-1 text-[11.5px] text-ink-2">{ASSET_CLASS_LABELS[a.asset_class]}</td>
                <td className="px-2.5 py-1 text-right text-[12px] tabular-nums text-ink font-semibold">{a.capacity_mw.toFixed(0)}</td>
                <td className="px-2.5 py-1 text-right text-[11.5px] tabular-nums text-ink-2">{a.commissioning_year}</td>
                <td className="px-2.5 py-1 text-[11px] text-ink-3 truncate max-w-[140px]">
                  {a.turbine_make ? `${a.turbine_make} ${a.turbine_model}` : 'fleet avg'}
                </td>
                <td className="px-2.5 py-1 text-[11.5px] text-ink-3 truncate max-w-[120px]">{a.operator || '—'}</td>
                <td className="px-2.5 py-1 text-right">
                  {deleteId === a.id ? (
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => { onDelete(a.id); setDeleteId(null) }}
                              className="text-[10.5px] font-semibold text-down hover:underline">Yes</button>
                      <button onClick={() => setDeleteId(null)}
                              className="text-[10.5px] text-ink-3 hover:underline">No</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeleteId(a.id)}
                            className="text-[10.5px] text-ink-4 hover:text-down">Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

// ── 02 Summary cards panel ────────────────────────────────────────────────────

function SummaryPanel({
  rollup, ccy, assets,
}: {
  rollup: PortfolioRollup
  ccy:    ReportingCcy
  assets: PortfolioAsset[]
}) {
  const sym = CCY_SYMBOL[ccy]
  const avgRetireYear = useMemo(() => {
    if (assets.length === 0) return null
    return Math.round(assets.reduce((s, a) => s + (a.commissioning_year + 25), 0) / assets.length)
  }, [assets])

  return (
    <Panel label="PORTFOLIO" title="Aggregate Exposure" className="col-span-4"
           meta={<span className="text-[10.5px] text-ink-4">{ccy} reporting</span>}>
      <div className="p-2.5 space-y-1.5">
        <div className="bg-canvas border border-border rounded-sm p-2.5">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Net Obligation</div>
          <div className="text-[20px] font-semibold text-down tabular-nums leading-none mt-1">{fmt(rollup.net_obligation_mid, sym)}</div>
          <div className="text-[10.5px] text-ink-4 mt-1 tabular-nums">
            {fmt(rollup.net_obligation_low, sym)} – {fmt(rollup.net_obligation_high, sym)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Liability</div>
            <div className="text-[14px] font-semibold text-ink tabular-nums leading-none mt-1">{fmt(rollup.liability_mid, sym)}</div>
            <div className="text-[10.5px] text-ink-4 mt-0.5">undiscounted</div>
          </div>
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">NRO offset</div>
            <div className="text-[14px] font-semibold text-up tabular-nums leading-none mt-1">{fmt(rollup.nro_mid, sym)}</div>
            <div className="text-[10.5px] text-ink-4 mt-0.5">recovery</div>
          </div>
        </div>

        <div className="bg-canvas border border-border rounded-sm p-2.5">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Present Value</div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-[16px] font-semibold text-ink tabular-nums leading-none">{fmt(rollup.pv_total, sym)}</span>
            <span className="text-[10.5px] text-ink-4">@ {rollup.discount_rate_pct}%</span>
          </div>
          <div className="text-[10.5px] text-ink-4 mt-1">
            Annual unwind <span className="text-amber tabular-nums">{fmt(rollup.annual_unwind, sym)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Capacity</div>
            <div className="text-[14px] font-semibold text-ink tabular-nums leading-none mt-1">{fmtMw(rollup.total_capacity_mw)}</div>
          </div>
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Avg retire</div>
            <div className="text-[14px] font-semibold text-ink tabular-nums leading-none mt-1">{avgRetireYear ?? '—'}</div>
          </div>
        </div>
      </div>
    </Panel>
  )
}

// ── 03 Liability Model panel ──────────────────────────────────────────────────

function LiabilityModelPanel({
  valuations, rollup, ccy,
}: {
  valuations: AssetValuation[]
  rollup:     PortfolioRollup
  ccy:        ReportingCcy
}) {
  const sym = CCY_SYMBOL[ccy]
  if (valuations.length === 0) {
    return (
      <Panel label="PORTFOLIO" title="Liability Model" className="col-span-7">
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Add assets to model liability</div>
      </Panel>
    )
  }

  return (
    <Panel label="PORTFOLIO" title="Liability Model" className="col-span-7"
           meta={<span className="text-[10.5px] text-ink-4">By country / class / site</span>}>
      <div className="grid grid-cols-2 gap-1.5 p-1.5">
        {/* By country */}
        <div className="bg-canvas border border-border rounded-sm overflow-hidden">
          <div className="px-2.5 py-1 bg-titlebar border-b border-border">
            <span className="label-xs">By Country</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase">Country</th>
                <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase">Series</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">MW</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Net Obl.</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rollup.by_country).sort((a, b) => b[1].net_mid - a[1].net_mid).map(([cc, v]) => (
                <tr key={cc} className="border-b border-border/70">
                  <td className="px-2 py-1 text-[11.5px] text-ink font-semibold">{cc}</td>
                  <td className="px-2 py-1 text-[10.5px] text-ink-3">{routeCountry(cc).series.replace('dci_', '')}</td>
                  <td className="px-2 py-1 text-right text-[11px] tabular-nums text-ink-2">{Math.round(v.mw)}</td>
                  <td className="px-2 py-1 text-right text-[11.5px] tabular-nums text-down font-semibold">{fmt(v.net_mid, sym)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* By class */}
        <div className="bg-canvas border border-border rounded-sm overflow-hidden">
          <div className="px-2.5 py-1 bg-titlebar border-b border-border">
            <span className="label-xs">By Asset Class</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase">Class</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Sites</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">MW</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Net Obl.</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rollup.by_class).sort((a, b) => b[1].net_mid - a[1].net_mid).map(([ac, v]) => (
                <tr key={ac} className="border-b border-border/70">
                  <td className="px-2 py-1 text-[11.5px] text-ink font-semibold">{ASSET_CLASS_LABELS[ac as AssetClass]}</td>
                  <td className="px-2 py-1 text-right text-[11px] tabular-nums text-ink-2">{v.count}</td>
                  <td className="px-2 py-1 text-right text-[11px] tabular-nums text-ink-2">{Math.round(v.mw)}</td>
                  <td className="px-2 py-1 text-right text-[11.5px] tabular-nums text-down font-semibold">{fmt(v.net_mid, sym)}</td>
                  <td className="px-2 py-1 text-right text-[10.5px] tabular-nums text-ink-3">
                    {rollup.net_obligation_mid > 0 ? `${((v.net_mid / rollup.net_obligation_mid) * 100).toFixed(0)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Site-level */}
        <div className="bg-canvas border border-border rounded-sm overflow-hidden col-span-2">
          <div className="px-2.5 py-1 bg-titlebar border-b border-border">
            <span className="label-xs">Site Detail</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase">Site</th>
                <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase">Country</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">MW</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Liability</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">NRO</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Net Obl.</th>
                <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">PV</th>
              </tr>
            </thead>
            <tbody>
              {[...valuations].sort((a, b) => (b.net_obligation_mid ?? 0) - (a.net_obligation_mid ?? 0)).map(v => (
                <tr key={v.asset.id} className="border-b border-border/70 hover:bg-raised">
                  <td className="px-2 py-1 text-[11.5px] text-ink font-semibold truncate max-w-[160px]">{v.asset.site_name}</td>
                  <td className="px-2 py-1 text-[11px] text-ink-2">{v.asset.country_code}</td>
                  <td className="px-2 py-1 text-right text-[11px] tabular-nums text-ink-2">{v.asset.capacity_mw.toFixed(0)}</td>
                  <td className="px-2 py-1 text-right text-[11px] tabular-nums text-down">{fmt(v.liability_mid, sym)}</td>
                  <td className="px-2 py-1 text-right text-[11px] tabular-nums text-up">({fmt(v.nro_mid, sym)})</td>
                  <td className="px-2 py-1 text-right text-[11.5px] tabular-nums text-down font-semibold">{fmt(v.net_obligation_mid, sym)}</td>
                  <td className="px-2 py-1 text-right text-[11.5px] tabular-nums text-ink font-semibold">{fmt(v.pv_obligation, sym)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  )
}

// ── 04 NRO Attribution panel ──────────────────────────────────────────────────

function NroAttributionPanel({
  valuations, rollup, ccy,
}: {
  valuations: AssetValuation[]
  rollup:     PortfolioRollup
  ccy:        ReportingCcy
}) {
  const sym = CCY_SYMBOL[ccy]
  const grandTotal = valuations.reduce((s, v) => s + (v.nro_mid ?? 0), 0)

  const byMaterial: Record<string, number> = {}
  for (const v of valuations) {
    for (const a of v.nro_attribution) {
      byMaterial[a.material] = (byMaterial[a.material] ?? 0) + a.value_mid
    }
  }

  const PALETTE = ['#0E7A86', '#14A4B4', '#D97706', '#0F8B58', '#7C3AED', '#0A5C66', '#6B7585']
  const slices: DonutSlice[] = Object.entries(byMaterial).sort((a, b) => b[1] - a[1])
    .map(([m, v], i) => ({ label: m.replace(/_/g, ' '), value: v, color: PALETTE[i % PALETTE.length] }))

  return (
    <Panel label="PORTFOLIO" title="NRO Attribution" className="col-span-5"
           meta={<span className="text-[10.5px] text-ink-4 tabular-nums">{fmt(grandTotal, sym)} total</span>}>
      {valuations.length === 0 ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Add assets to compute NRO</div>
      ) : (
        <div className="p-2 space-y-2">
          <MaterialDonut slices={slices} total={grandTotal} currency={ccy} centerLabel="Material NRO" height={170} />
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-titlebar border-b border-border">
                  <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Material</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Value</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">%</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byMaterial).sort((a, b) => b[1] - a[1]).map(([m, v]) => (
                  <tr key={m} className="border-b border-border/70">
                    <td className="px-2 py-0.5 text-[11.5px] text-ink capitalize">{m.replace(/_/g, ' ')}</td>
                    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-up font-semibold">{fmt(v, sym)}</td>
                    <td className="px-2 py-0.5 text-right text-[10.5px] tabular-nums text-ink-3">
                      {grandTotal > 0 ? `${((v / grandTotal) * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── 05 IFRS Schedule panel ────────────────────────────────────────────────────

function IfrsSchedulePanel({
  valuations, rollup, ccy, discountRate, onDiscountRateChange,
}: {
  valuations:           AssetValuation[]
  rollup:               PortfolioRollup
  ccy:                  ReportingCcy
  discountRate:         number
  onDiscountRateChange: (v: number) => void
}) {
  const sym = CCY_SYMBOL[ccy]

  return (
    <Panel label="PORTFOLIO" title="IFRS IAS 37 Schedule" className="col-span-7"
           meta={
             <button onClick={() => downloadCsv('endenex_ifrs_schedule.csv', ifrsScheduleCsv(valuations, rollup))}
                     disabled={valuations.length === 0}
                     className="px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase text-teal border border-teal/40 rounded-sm hover:bg-teal-dim disabled:opacity-40">
               CSV
             </button>
           }>
      {valuations.length === 0 ? (
        <div className="px-3 py-6 text-[12px] text-ink-3 text-center">Add assets to generate IFRS schedule</div>
      ) : (
        <div className="p-2 space-y-2">
          {/* Discount rate slider */}
          <div className="bg-canvas border border-border rounded-sm p-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold text-ink-3 uppercase tracking-wide">Discount Rate (p.a.)</span>
              <span className="text-[14px] font-semibold text-ink tabular-nums">{discountRate.toFixed(1)}%</span>
            </div>
            <input type="range" min={0} max={10} step={0.1}
                   value={discountRate}
                   onChange={e => onDiscountRateChange(parseFloat(e.target.value))}
                   className="w-full accent-teal" />
            <div className="grid grid-cols-3 gap-2 mt-2">
              <div className="text-center">
                <div className="text-[10px] text-ink-4 uppercase tracking-wide">Present Value</div>
                <div className="text-[14px] font-semibold text-ink tabular-nums">{fmt(rollup.pv_total, sym)}</div>
              </div>
              <div className="text-center border-x border-border">
                <div className="text-[10px] text-ink-4 uppercase tracking-wide">Current</div>
                <div className="text-[14px] font-semibold text-down tabular-nums">{fmt(rollup.current_portion, sym)}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] text-ink-4 uppercase tracking-wide">Annual Unwind</div>
                <div className="text-[14px] font-semibold text-amber tabular-nums">{fmt(rollup.annual_unwind, sym)}</div>
              </div>
            </div>
          </div>

          {/* Schedule table */}
          <div className="border border-border rounded-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-titlebar border-b border-border">
                  <th className="px-2 py-1 text-left text-[10px] font-semibold text-ink-3 uppercase">Site</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Retires</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Net Obl.</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">PV</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Current</th>
                  <th className="px-2 py-1 text-right text-[10px] font-semibold text-ink-3 uppercase">Unwind</th>
                </tr>
              </thead>
              <tbody>
                {[...valuations].sort((a, b) => (b.pv_obligation ?? 0) - (a.pv_obligation ?? 0)).map(v => (
                  <tr key={v.asset.id} className="border-b border-border/70 hover:bg-raised">
                    <td className="px-2 py-0.5 text-[11.5px] text-ink font-semibold truncate max-w-[140px]">{v.asset.site_name}</td>
                    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-ink-2">{v.retirement_year}</td>
                    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-down">{fmt(v.net_obligation_mid, sym)}</td>
                    <td className="px-2 py-0.5 text-right text-[11.5px] tabular-nums text-ink font-semibold">{fmt(v.pv_obligation, sym)}</td>
                    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-down">{fmt(v.current_portion, sym)}</td>
                    <td className="px-2 py-0.5 text-right text-[11px] tabular-nums text-amber">{fmt(v.annual_unwind, sym)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-strong bg-titlebar font-semibold">
                  <td className="px-2 py-1 text-[11.5px] text-ink uppercase tracking-wide">Total</td>
                  <td></td>
                  <td className="px-2 py-1 text-right text-[12px] tabular-nums text-down font-semibold">{fmt(rollup.net_obligation_mid, sym)}</td>
                  <td className="px-2 py-1 text-right text-[12px] tabular-nums text-ink font-semibold">{fmt(rollup.pv_total, sym)}</td>
                  <td className="px-2 py-1 text-right text-[12px] tabular-nums text-down font-semibold">{fmt(rollup.current_portion, sym)}</td>
                  <td className="px-2 py-1 text-right text-[12px] tabular-nums text-amber font-semibold">{fmt(rollup.annual_unwind, sym)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}

// ── 06 Sensitivity panel ──────────────────────────────────────────────────────

function SensitivityPanel({
  valuations, rollup, ccy,
}: {
  valuations: AssetValuation[]
  rollup:     PortfolioRollup
  ccy:        ReportingCcy
}) {
  const sym = CCY_SYMBOL[ccy]
  const [steelAdj, setSteelAdj]     = useState(0)
  const [copperAdj, setCopperAdj]   = useState(0)
  const [gateAdj, setGateAdj]       = useState(0)
  const [timingAdj, setTimingAdj]   = useState(0)
  const [discountAdj, setDiscountAdj] = useState(0)

  const STEEL_SHARE = 0.62, COPPER_SHARE = 0.30
  const nroAdjFactor = STEEL_SHARE * (1 + steelAdj/100) + COPPER_SHARE * (1 + copperAdj/100) + 0.08
  const liabAdjFactor = 1 + gateAdj/100
  const timingFactor  = Math.pow(1.025, timingAdj)
  const adjLiability  = rollup.liability_mid * liabAdjFactor * timingFactor
  const adjNro        = rollup.nro_mid * nroAdjFactor * timingFactor
  const adjNet        = adjLiability - adjNro

  const avgYears = valuations.length
    ? valuations.reduce((s, v) => s + v.years_to_retirement * v.asset.capacity_mw, 0) / rollup.total_capacity_mw
    : 0
  const newRate = (rollup.discount_rate_pct + discountAdj) / 100
  const adjPv = newRate >= 0 ? adjNet / Math.pow(1 + newRate, avgYears) : adjNet

  const baseNet = rollup.net_obligation_mid
  const basePv = rollup.pv_total
  const netDelta = adjNet - baseNet
  const pvDelta = adjPv - basePv

  const sliders: [string, number, (v: number) => void, number, number, string][] = [
    ['Steel scrap',    steelAdj,    setSteelAdj,    -30, 30, '%'],
    ['Copper price',   copperAdj,   setCopperAdj,   -30, 30, '%'],
    ['Gate fees',      gateAdj,     setGateAdj,     -30, 30, '%'],
    ['Timing offset',  timingAdj,   setTimingAdj,    -5, 10, 'y'],
    ['Discount Δ',     discountAdj, setDiscountAdj,  -3,  3, 'pp'],
  ]

  return (
    <Panel label="PORTFOLIO" title="Sensitivity" className="col-span-5"
           meta={
             <button onClick={() => { setSteelAdj(0); setCopperAdj(0); setGateAdj(0); setTimingAdj(0); setDiscountAdj(0) }}
                     className="px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase text-ink-3 border border-border rounded-sm hover:text-ink">
               Reset
             </button>
           }>
      <div className="p-2 space-y-2">
        {/* Sliders */}
        <div className="space-y-1.5">
          {sliders.map(([label, val, setter, min, max, unit]) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] text-ink-2 font-medium">{label}</span>
                <span className={clsx('text-[11px] font-semibold tabular-nums',
                  val > 0 ? 'text-down' : val < 0 ? 'text-up' : 'text-ink-4')}>
                  {val > 0 ? '+' : ''}{val}{unit}
                </span>
              </div>
              <input type="range" min={min} max={max} step={1} value={val}
                     onChange={e => setter(parseFloat(e.target.value))}
                     className="w-full h-1 accent-teal" />
            </div>
          ))}
        </div>

        {/* Impact */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Net obligation</div>
            <div className="text-[14px] font-semibold text-down tabular-nums leading-none mt-1">{fmt(adjNet, sym)}</div>
            <div className={clsx('text-[10.5px] tabular-nums mt-0.5 font-semibold',
              netDelta > 0 ? 'text-down' : netDelta < 0 ? 'text-up' : 'text-ink-4')}>
              {netDelta > 0 ? '+' : ''}{fmt(netDelta, sym)}
            </div>
          </div>
          <div className="bg-canvas border border-border rounded-sm p-2">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-3 font-semibold">Present value</div>
            <div className="text-[14px] font-semibold text-ink tabular-nums leading-none mt-1">{fmt(adjPv, sym)}</div>
            <div className={clsx('text-[10.5px] tabular-nums mt-0.5 font-semibold',
              pvDelta > 0 ? 'text-down' : pvDelta < 0 ? 'text-up' : 'text-ink-4')}>
              {pvDelta > 0 ? '+' : ''}{fmt(pvDelta, sym)}
            </div>
          </div>
        </div>

        <p className="text-[10.5px] text-ink-4 leading-snug">
          Material shares: steel 62% / copper 30% / Al 8%. Timing: 2.5%/yr inflation. Avg years to retirement: {avgYears.toFixed(1)}.
        </p>
      </div>
    </Panel>
  )
}

// ── 07 Investor Pack panel ────────────────────────────────────────────────────

function InvestorPackPanel({
  assets, valuations, rollup, ccy,
}: {
  assets:     PortfolioAsset[]
  valuations: AssetValuation[]
  rollup:     PortfolioRollup
  ccy:        ReportingCcy
}) {
  const [organization, setOrganization] = useState('')
  const [preparedFor, setPreparedFor]   = useState('')

  const openBoardMemo = () => {
    const html = boardMemoHtml(valuations, rollup, { organization, prepared_for: preparedFor })
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (w) { w.document.write(html); w.document.close() }
  }
  const downloadIfrs   = () => downloadCsv('endenex_ifrs_schedule.csv', ifrsScheduleCsv(valuations, rollup))
  const downloadSurety = () => downloadCsv('endenex_surety_pack.csv',   suretyPackCsv(valuations, rollup))
  const downloadMethod = () => {
    const blob = new Blob([methodologyMd(rollup)], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'endenex_methodology.md'; a.click()
    URL.revokeObjectURL(url)
  }
  const downloadCsvAssets = () => {
    const headers = ['site_name','country_code','asset_class','capacity_mw','turbine_count','commissioning_year','turbine_make','turbine_model','operator','notes']
    const rows = assets.map(a => [a.site_name, a.country_code, a.asset_class, a.capacity_mw, a.turbine_count ?? '', a.commissioning_year, a.turbine_make ?? '', a.turbine_model ?? '', a.operator, a.notes])
    downloadCsv('endenex_portfolio.csv', toCsv([headers, ...rows]))
  }

  const disabled = valuations.length === 0

  const exports: { title: string; desc: string; onClick: () => void; primary?: boolean }[] = [
    { title: 'Board Memo (HTML)',       desc: 'PV, current portion, top 10 sites, IAS 37 schedule', onClick: openBoardMemo, primary: true },
    { title: 'IFRS IAS 37 Schedule',    desc: 'Auditor-ready CSV with PV, current/non-current split', onClick: downloadIfrs, primary: true },
    { title: 'Surety Pack',             desc: 'High-confidence figures for bond sizing',              onClick: downloadSurety, primary: true },
    { title: 'Methodology (MD)',        desc: 'DCI formula, sources, IAS 37 construction notes',     onClick: downloadMethod },
    { title: 'Portfolio CSV',           desc: 'Import-compatible roundtrip format',                  onClick: downloadCsvAssets },
  ]

  return (
    <Panel label="PORTFOLIO" title="Investor Pack" className="col-span-7"
           meta={<span className="text-[10.5px] text-ink-4">5 export formats</span>}>
      <div className="p-2 space-y-2">
        {/* Optional metadata */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Organisation</label>
            <input className="w-full h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                   value={organization} onChange={e => setOrganization(e.target.value)}
                   placeholder="Acme Renewables Holdings Ltd" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Prepared for</label>
            <input className="w-full h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                   value={preparedFor} onChange={e => setPreparedFor(e.target.value)}
                   placeholder="Audit Committee · 30 May 2026" />
          </div>
        </div>

        {/* Export grid */}
        <div className="grid grid-cols-1 gap-1">
          {exports.map(e => (
            <div key={e.title} className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-canvas border border-border rounded-sm">
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-ink">{e.title}</div>
                <div className="text-[10.5px] text-ink-3 truncate">{e.desc}</div>
              </div>
              <button onClick={e.onClick} disabled={disabled}
                      className={clsx(
                        'px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide rounded-sm flex-shrink-0',
                        e.primary
                          ? 'bg-teal text-white hover:bg-teal-bright disabled:opacity-40'
                          : 'border border-teal/40 text-teal hover:bg-teal-dim disabled:opacity-40',
                      )}>
                Generate
              </button>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── 08 Add Site / CSV import panel ────────────────────────────────────────────

function AddSitePanel({
  onAdd, onLoadSample, hasAssets,
}: {
  onAdd: (a: Omit<PortfolioAsset, 'id'>) => void
  onLoadSample: () => void
  hasAssets: boolean
}) {
  const [mode, setMode] = useState<'form' | 'csv'>('form')
  const [form, setForm] = useState(BLANK_ASSET)
  const [csvText, setCsvText] = useState('')
  const [csvError, setCsvError] = useState<string | null>(null)
  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const valid = form.site_name.trim() !== '' && form.capacity_mw > 0

  const submit = () => {
    if (!valid) return
    onAdd(form)
    setForm(BLANK_ASSET)
  }

  const parseCsv = () => {
    setCsvError(null)
    const lines = csvText.trim().split('\n').filter(Boolean)
    if (lines.length < 2) { setCsvError('Paste at least one data row below the header'); return }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    const required = ['site_name', 'country_code', 'asset_class', 'capacity_mw', 'commissioning_year']
    const missing = required.filter(r => !headers.includes(r))
    if (missing.length) { setCsvError(`Missing: ${missing.join(', ')}`); return }
    let added = 0
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      const get = (col: string) => vals[headers.indexOf(col)] ?? ''
      const mw = parseFloat(get('capacity_mw')); const year = parseInt(get('commissioning_year'))
      if (!get('site_name') || isNaN(mw) || isNaN(year)) continue
      onAdd({
        site_name: get('site_name'),
        country_code: get('country_code') || 'DE',
        asset_class: (get('asset_class') as AssetClass) || 'onshore_wind',
        capacity_mw: mw,
        turbine_count: parseInt(get('turbine_count')) || null,
        commissioning_year: year,
        operator: get('operator') || '',
        notes: get('notes') || '',
        turbine_make: get('turbine_make') || null,
        turbine_model: get('turbine_model') || null,
      })
      added++
    }
    if (added === 0) setCsvError('No valid rows found')
    else { setCsvText(''); setCsvError(null) }
  }

  return (
    <Panel label="PORTFOLIO" title="Add Site" className="col-span-5"
           meta={
             <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
               <button onClick={() => setMode('form')}
                       className={clsx('px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm uppercase',
                         mode === 'form' ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink')}>
                 Form
               </button>
               <button onClick={() => setMode('csv')}
                       className={clsx('px-1.5 py-0.5 text-[10px] font-bold tracking-wide rounded-sm uppercase',
                         mode === 'csv' ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink')}>
                 CSV
               </button>
             </div>
           }>
      <div className="p-2 space-y-2">
        {!hasAssets && (
          <button onClick={onLoadSample}
                  className="w-full px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-teal border border-teal/40 rounded-sm hover:bg-teal-dim">
            ✨ Load sample portfolio (6 sites)
          </button>
        )}

        {mode === 'form' ? (
          <div className="space-y-1.5">
            <input
              className="w-full h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
              value={form.site_name} onChange={e => set('site_name', e.target.value)}
              placeholder="Site name *" />
            <div className="grid grid-cols-2 gap-1.5">
              <select className="h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                      value={form.country_code} onChange={e => set('country_code', e.target.value)}>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                      value={form.asset_class} onChange={e => set('asset_class', e.target.value as AssetClass)}>
                {(Object.keys(ASSET_CLASS_LABELS) as AssetClass[]).map(k => (
                  <option key={k} value={k}>{ASSET_CLASS_LABELS[k]}</option>
                ))}
              </select>
              <input type="number" min={0} step={0.1}
                     className="h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                     value={form.capacity_mw || ''}
                     onChange={e => set('capacity_mw', parseFloat(e.target.value) || 0)}
                     placeholder="Capacity MW *" />
              <input type="number" min={1990} max={new Date().getFullYear()}
                     className="h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                     value={form.commissioning_year}
                     onChange={e => set('commissioning_year', parseInt(e.target.value) || 2000)} />
              <select className="col-span-2 h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                      value={form.turbine_model ?? ''}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '') { set('turbine_make', null); set('turbine_model', null); return }
                        const [make, model] = v.split('|')
                        set('turbine_make', make); set('turbine_model', model)
                      }}>
                <option value="">Turbine: Fleet average</option>
                {TURBINE_PRESETS.map(t => (
                  <option key={`${t.make}|${t.model}`} value={`${t.make}|${t.model}`}>{t.make} {t.model}</option>
                ))}
              </select>
              <input className="col-span-2 h-7 px-2 text-[12px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal"
                     value={form.operator} onChange={e => set('operator', e.target.value)}
                     placeholder="Operator (optional)" />
            </div>
            <button onClick={submit} disabled={!valid}
                    className="w-full px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-teal text-white rounded-sm hover:bg-teal-bright disabled:opacity-40">
              + Add Site
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[10.5px] text-ink-3 leading-snug">
              Required: <span className="font-semibold">site_name, country_code, asset_class, capacity_mw, commissioning_year</span>
            </p>
            <textarea className="w-full h-32 p-1.5 text-[11px] text-ink bg-canvas border border-border rounded-sm focus:outline-none focus:border-teal resize-none font-mono"
                      value={csvText} onChange={e => setCsvText(e.target.value)}
                      placeholder={`site_name,country_code,asset_class,capacity_mw,commissioning_year\nHornsea One,GB,offshore_wind,1218,2019`} />
            {csvError && <p className="text-[11px] text-down">{csvError}</p>}
            <button onClick={parseCsv}
                    className="w-full px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-teal text-white rounded-sm hover:bg-teal-bright">
              Import CSV
            </button>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function PortfolioPage() {
  const [assets, setAssets]             = useState<PortfolioAsset[]>(() => loadPortfolio())
  const [reportingCcy, setReportingCcy] = useState<ReportingCcy>('EUR')
  const [discountRate, setDiscountRate] = useState<number>(4.5)

  const [dciByS, setDciByS]         = useState<Partial<Record<DciSnapshot['series'], DciSnapshot>>>({})
  const [nroByMR, setNroByMR]       = useState<Map<string, NroSnapshot>>(new Map())
  const [lcaByModel, setLcaByModel] = useState<Map<string, TurbineLcaRow[]>>(new Map())
  const [fxRates, setFxRates]       = useState<FxRate[]>([])
  const [countryMults, setCountryMults] = useState<CountryMultipliers[]>([])

  useEffect(() => { savePortfolio(assets) }, [assets])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [dciRes, nroRes, lcaRes, fxRes, multRes] = await Promise.all([
          supabase.from('dci_publications')
            .select('series, publication_date, index_value, net_liability, net_liability_low, net_liability_high, currency, methodology_version')
            .eq('is_published', true).order('publication_date', { ascending: false }),
          supabase.from('nro_estimates')
            .select('material_type, region, reference_date, net_per_mw_low, net_per_mw_mid, net_per_mw_high, currency')
            .order('reference_date', { ascending: false }),
          supabase.from('turbine_material_profiles')
            .select('turbine_make, turbine_model, material_type, volume_per_mw'),
          supabase.from('fx_rates')
            .select('base_currency, quote_currency, rate, rate_date')
            .order('rate_date', { ascending: false }),
          supabase.from('country_cost_multipliers')
            .select('country_code, labour_mult, plant_mult, haul_mult, gate_mult'),
        ])
        if (!alive) return

        const dci: Partial<Record<DciSnapshot['series'], DciSnapshot>> = {}
        for (const row of (dciRes.data ?? []) as DciSnapshot[]) {
          if (!dci[row.series]) dci[row.series] = row
        }
        setDciByS(dci)

        const nro = new Map<string, NroSnapshot>()
        for (const row of (nroRes.data ?? []) as NroSnapshot[]) {
          const key = `${row.material_type}|${row.region}`
          if (!nro.has(key)) nro.set(key, row)
        }
        setNroByMR(nro)

        const lca = new Map<string, TurbineLcaRow[]>()
        for (const row of (lcaRes.data ?? []) as TurbineLcaRow[]) {
          const key = `${row.turbine_make}|${row.turbine_model}`
          const arr = lca.get(key) ?? []
          arr.push(row)
          lca.set(key, arr)
        }
        setLcaByModel(lca)

        const fxLatest = new Map<string, FxRate>()
        for (const row of (fxRes.data ?? []) as FxRate[]) {
          if (!fxLatest.has(row.quote_currency)) fxLatest.set(row.quote_currency, row)
        }
        setFxRates(Array.from(fxLatest.values()))

        setCountryMults((multRes.data ?? []) as CountryMultipliers[])
      } catch { /* */ }
    })()
    return () => { alive = false }
  }, [])

  const valuations = useMemo(() => assets.map(a =>
    valueAsset(a, dciByS, nroByMR, lcaByModel, fxRates, countryMults, {
      reporting_currency: reportingCcy,
      discount_rate_pct:  discountRate,
      asof_year:          new Date().getFullYear(),
      asof_date:          new Date().toISOString().slice(0, 10),
    })
  ), [assets, dciByS, nroByMR, lcaByModel, fxRates, countryMults, reportingCcy, discountRate])

  const rollup = useMemo(() => rollupPortfolio(
    valuations, reportingCcy, discountRate, new Date().toISOString().slice(0, 10),
  ), [valuations, reportingCcy, discountRate])

  const addAsset    = useCallback((a: Omit<PortfolioAsset, 'id'>) => setAssets(prev => [...prev, { ...a, id: uid() }]), [])
  const updateAsset = useCallback((id: string, a: Omit<PortfolioAsset, 'id'>) => setAssets(prev => prev.map(p => p.id === id ? { ...a, id } : p)), [])
  const deleteAsset = useCallback((id: string) => setAssets(prev => prev.filter(p => p.id !== id)), [])
  const loadSample  = useCallback(() => { setAssets(loadSampleAssets().map(a => ({ ...a, id: uid() }))) }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-page">

      <div className="flex-shrink-0 h-9 px-3 border-b border-border bg-canvas flex items-center justify-between">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold text-ink uppercase tracking-wide">Portfolio Analytics</h1>
          <span className="text-[11.5px] text-ink-3">Liability · NRO · IFRS · sensitivity · investor pack</span>
        </div>
        <div className="flex items-center gap-3 text-[10.5px] text-ink-3 flex-shrink-0 uppercase tracking-wide">
          <span>Reporting</span>
          <select className="h-6 px-1.5 text-[11px] font-semibold text-ink bg-panel border border-border rounded-sm focus:outline-none focus:border-teal"
                  value={reportingCcy}
                  onChange={e => setReportingCcy(e.target.value as ReportingCcy)}>
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
            <option value="GBP">GBP £</option>
          </select>
          <span className="cell-divider" />
          <span className="px-1.5 py-px bg-canvas border border-border rounded-sm text-ink-3 normal-case font-semibold tabular-nums">
            {assets.length} site{assets.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-1.5">
        <div className="h-full grid grid-cols-12 grid-rows-4 gap-1.5">
          <AssetsPanel        assets={assets} onUpdate={updateAsset} onDelete={deleteAsset} />
          <SummaryPanel       rollup={rollup} ccy={reportingCcy} assets={assets} />
          <LiabilityModelPanel valuations={valuations} rollup={rollup} ccy={reportingCcy} />
          <NroAttributionPanel valuations={valuations} rollup={rollup} ccy={reportingCcy} />
          <IfrsSchedulePanel  valuations={valuations} rollup={rollup} ccy={reportingCcy}
                              discountRate={discountRate} onDiscountRateChange={setDiscountRate} />
          <SensitivityPanel   valuations={valuations} rollup={rollup} ccy={reportingCcy} />
          <InvestorPackPanel  assets={assets} valuations={valuations} rollup={rollup} ccy={reportingCcy} />
          <AddSitePanel       onAdd={addAsset} onLoadSample={loadSample} hasAssets={assets.length > 0} />
        </div>
      </div>

    </div>
  )
}
