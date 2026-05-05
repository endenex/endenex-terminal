// ── Portfolio Analytics (Tab 06) ─────────────────────────────────────────────
// User's own asset portfolio — investor-grade liability modelling.
// Spec: Product Brief v1.0 §6
//
// Architecture
//   • Portfolio assets persisted in localStorage (endenex_portfolio_v1)
//   • Live DCI / NRO / FX pulled from Supabase on mount
//   • All valuation logic in src/lib/portfolio-engine.ts (pure, deterministic)
//   • Investor-grade exports in src/lib/portfolio-export.ts

import { useState, useEffect, useCallback, useMemo } from 'react'
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

type SubTab = 'assets' | 'liability' | 'nro' | 'ifrs' | 'scenarios' | 'export'
type ReportingCcy = 'EUR' | 'USD' | 'GBP'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'endenex_portfolio_v1'

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  onshore_wind:  'Onshore Wind',
  offshore_wind: 'Offshore Wind',
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

function fmtFull(n: number | null | undefined, sym = '€') {
  if (n == null || isNaN(n)) return '—'
  return `${sym}${Math.round(n).toLocaleString('en-GB')}`
}

// ── Sub-tab nav ───────────────────────────────────────────────────────────────

const TABS: { id: SubTab; label: string; num: string }[] = [
  { id: 'assets',    label: 'Portfolio Assets',     num: '01' },
  { id: 'liability', label: 'Liability Model',      num: '02' },
  { id: 'nro',       label: 'NRO Attribution',      num: '03' },
  { id: 'ifrs',      label: 'IFRS IAS 37 Schedule', num: '04' },
  { id: 'scenarios', label: 'Sensitivity',          num: '05' },
  { id: 'export',    label: 'Investor Pack',        num: '06' },
]

function SubTabNav({ active, onChange }: { active: SubTab; onChange: (t: SubTab) => void }) {
  return (
    <div className="flex-shrink-0 flex items-center gap-0 border-b border-border bg-panel px-4 overflow-x-auto">
      {TABS.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-shrink-0 px-4 py-2.5 text-[11px] font-semibold tracking-wide border-b-2 transition-colors ${
            active === t.id
              ? 'border-teal text-teal'
              : 'border-transparent text-ink-3 hover:text-ink-2'
          }`}
        >
          <span className="text-ink-4 mr-1.5">{t.num}</span>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Asset form ────────────────────────────────────────────────────────────────

function AssetForm({
  initial, onSave, onCancel,
}: {
  initial: Omit<PortfolioAsset, 'id'>
  onSave: (a: Omit<PortfolioAsset, 'id'>) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState(initial)
  const set = (k: keyof typeof form, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  const valid = form.site_name.trim() !== '' && form.capacity_mw > 0 &&
                form.commissioning_year >= 1990 && form.commissioning_year <= new Date().getFullYear()

  return (
    <div className="bg-panel border border-border rounded-lg p-5 space-y-4">
      <p className="text-[11px] font-semibold text-ink-2 uppercase tracking-wide">
        {initial.site_name ? 'Edit Site' : 'Add Site'}
      </p>
      <div className="grid grid-cols-3 gap-x-6 gap-y-3">
        <div className="col-span-3">
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Site Name *</label>
          <input className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                 value={form.site_name} onChange={e => set('site_name', e.target.value)} placeholder="e.g. Sheringham Shoal" />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Country</label>
          <select className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                  value={form.country_code} onChange={e => set('country_code', e.target.value)}>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Asset Class</label>
          <select className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                  value={form.asset_class} onChange={e => set('asset_class', e.target.value as AssetClass)}>
            {(Object.keys(ASSET_CLASS_LABELS) as AssetClass[]).map(k => (
              <option key={k} value={k}>{ASSET_CLASS_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Commissioned</label>
          <input type="number" min={1990} max={new Date().getFullYear()}
                 className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                 value={form.commissioning_year}
                 onChange={e => set('commissioning_year', parseInt(e.target.value) || 2000)} />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Capacity (MW) *</label>
          <input type="number" min={0} step={0.1}
                 className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                 value={form.capacity_mw || ''}
                 onChange={e => set('capacity_mw', parseFloat(e.target.value) || 0)} />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Turbine Count</label>
          <input type="number" min={0} step={1}
                 className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                 value={form.turbine_count ?? ''}
                 onChange={e => { const v = e.target.value; set('turbine_count', v === '' ? null : parseInt(v)) }}
                 placeholder="Optional" />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Turbine Model</label>
          <select className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                  value={form.turbine_model ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '') { set('turbine_make', null); set('turbine_model', null); return }
                    const [make, model] = v.split('|')
                    set('turbine_make', make); set('turbine_model', model)
                  }}>
            <option value="">— Fleet average —</option>
            {TURBINE_PRESETS.map(t => (
              <option key={`${t.make}|${t.model}`} value={`${t.make}|${t.model}`}>{t.make} {t.model}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Operator</label>
          <input className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                 value={form.operator} onChange={e => set('operator', e.target.value)} placeholder="Optional" />
        </div>
        <div className="col-span-3">
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Notes</label>
          <input className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                 value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
        </div>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button onClick={() => valid && onSave(form)} disabled={!valid}
                className="px-4 py-1.5 text-[11px] font-semibold bg-teal text-white rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
          Save Site
        </button>
        <button onClick={onCancel}
                className="px-4 py-1.5 text-[11px] font-semibold text-ink-3 hover:text-ink border border-border rounded">
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── CSV import ────────────────────────────────────────────────────────────────

function CsvImport({ onImport }: { onImport: (assets: Omit<PortfolioAsset, 'id'>[]) => void }) {
  const [open, setOpen]   = useState(false)
  const [text, setText]   = useState('')
  const [error, setError] = useState<string | null>(null)

  const parse = () => {
    setError(null)
    const lines = text.trim().split('\n').filter(Boolean)
    if (lines.length < 2) { setError('Paste at least one data row below the header.'); return }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
    const required = ['site_name', 'country_code', 'asset_class', 'capacity_mw', 'commissioning_year']
    const missing  = required.filter(r => !headers.includes(r))
    if (missing.length) { setError(`Missing columns: ${missing.join(', ')}`); return }

    const assets: Omit<PortfolioAsset, 'id'>[] = []
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      const get  = (col: string) => vals[headers.indexOf(col)] ?? ''
      const mw   = parseFloat(get('capacity_mw'))
      const year = parseInt(get('commissioning_year'))
      if (!get('site_name') || isNaN(mw) || isNaN(year)) continue
      assets.push({
        site_name:          get('site_name'),
        country_code:       get('country_code') || 'DE',
        asset_class:        (get('asset_class') as AssetClass) || 'onshore_wind',
        capacity_mw:        mw,
        turbine_count:      parseInt(get('turbine_count')) || null,
        commissioning_year: year,
        operator:           get('operator') || '',
        notes:              get('notes') || '',
        turbine_make:       get('turbine_make') || null,
        turbine_model:      get('turbine_model') || null,
      })
    }
    if (!assets.length) { setError('No valid rows found.'); return }
    onImport(assets); setOpen(false); setText('')
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              className="px-3 py-1.5 text-[11px] font-semibold text-ink-3 border border-border rounded hover:border-teal hover:text-teal">
        CSV Import
      </button>
    )
  }
  return (
    <div className="bg-panel border border-border rounded-lg p-5 space-y-3">
      <p className="text-[11px] font-semibold text-ink-2">Paste CSV — required: site_name, country_code, asset_class, capacity_mw, commissioning_year. Optional: turbine_make, turbine_model, turbine_count, operator, notes.</p>
      <textarea className="w-full h-32 p-2 text-[11px] text-ink font-mono bg-page border border-border rounded focus:outline-none focus:border-teal resize-none"
                value={text} onChange={e => setText(e.target.value)}
                placeholder="site_name,country_code,asset_class,capacity_mw,commissioning_year,turbine_make,turbine_model
Hornsea One,GB,offshore_wind,1218,2019,Siemens Gamesa,SG 2.5-114" />
      {error && <p className="text-[11px] text-down">{error}</p>}
      <div className="flex gap-3">
        <button onClick={parse} className="px-4 py-1.5 text-[11px] font-semibold bg-teal text-white rounded hover:opacity-90">Import</button>
        <button onClick={() => { setOpen(false); setText(''); setError(null) }}
                className="px-4 py-1.5 text-[11px] font-semibold text-ink-3 border border-border rounded hover:text-ink">Cancel</button>
      </div>
    </div>
  )
}

// ── Sample portfolio ──────────────────────────────────────────────────────────

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

// ── 01 Assets Tab ─────────────────────────────────────────────────────────────

function AssetsTab({
  assets, onAdd, onUpdate, onDelete, onLoadSample,
}: {
  assets: PortfolioAsset[]
  onAdd: (a: Omit<PortfolioAsset, 'id'>) => void
  onUpdate: (id: string, a: Omit<PortfolioAsset, 'id'>) => void
  onDelete: (id: string) => void
  onLoadSample: () => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const totalMw = assets.reduce((s, a) => s + a.capacity_mw, 0)

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">
      <div className="flex items-center gap-6">
        <div>
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Sites</p>
          <p className="text-[22px] font-semibold text-ink tabular-nums">{assets.length}</p>
        </div>
        <div className="w-px h-8 bg-border" />
        <div>
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Total Capacity</p>
          <p className="text-[22px] font-semibold text-ink tabular-nums">{fmtMw(totalMw)}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {assets.length === 0 && (
            <button onClick={onLoadSample}
                    className="px-3 py-1.5 text-[11px] font-semibold text-teal border border-teal/40 rounded hover:bg-teal/10">
              Load sample portfolio
            </button>
          )}
          <CsvImport onImport={imported => imported.forEach(onAdd)} />
          <button onClick={() => { setShowForm(true); setEditId(null) }}
                  className="px-4 py-1.5 text-[11px] font-semibold bg-teal text-white rounded hover:opacity-90">
            + Add Site
          </button>
        </div>
      </div>

      {showForm && !editId && (
        <AssetForm initial={BLANK_ASSET}
                   onSave={a => { onAdd(a); setShowForm(false) }}
                   onCancel={() => setShowForm(false)} />
      )}

      {assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[13px] font-semibold text-ink-2 mb-1">No sites in your portfolio</p>
          <p className="text-[12px] text-ink-3">Add a site, import via CSV, or load the sample portfolio to begin modelling.</p>
        </div>
      ) : (
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Site</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Country</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Class</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">MW</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Comm.</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Turbine</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Operator</th>
                <th className="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a, i) => (
                <>
                  <tr key={a.id} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                    <td className="px-4 py-2.5 font-semibold text-ink">{a.site_name}</td>
                    <td className="px-4 py-2.5 text-ink-2">{a.country_code}</td>
                    <td className="px-4 py-2.5 text-ink-2">{ASSET_CLASS_LABELS[a.asset_class]}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{a.capacity_mw.toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-2">{a.commissioning_year}</td>
                    <td className="px-4 py-2.5 text-ink-3 text-[11px]">{a.turbine_make ? `${a.turbine_make} ${a.turbine_model}` : 'fleet avg'}</td>
                    <td className="px-4 py-2.5 text-ink-2">{a.operator || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setEditId(editId === a.id ? null : a.id)}
                                className="text-[10px] text-teal hover:underline">Edit</button>
                        <button onClick={() => setDeleteId(a.id)}
                                className="text-[10px] text-down hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                  {editId === a.id && (
                    <tr key={`${a.id}-edit`}>
                      <td colSpan={8} className="px-4 py-3 bg-highlight/5">
                        <AssetForm initial={{ ...a }}
                                   onSave={updated => { onUpdate(a.id, updated); setEditId(null) }}
                                   onCancel={() => setEditId(null)} />
                      </td>
                    </tr>
                  )}
                  {deleteId === a.id && (
                    <tr key={`${a.id}-del`}>
                      <td colSpan={8} className="px-4 py-2.5 bg-down/5">
                        <div className="flex items-center gap-4">
                          <span className="text-[12px] text-ink">Remove <strong>{a.site_name}</strong>?</span>
                          <button onClick={() => { onDelete(a.id); setDeleteId(null) }}
                                  className="text-[11px] font-semibold text-down hover:underline">Yes, remove</button>
                          <button onClick={() => setDeleteId(null)}
                                  className="text-[11px] text-ink-3 hover:underline">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── 02 Liability Model ────────────────────────────────────────────────────────

function LiabilityModel({
  valuations, rollup, ccy, loading,
}: {
  valuations: AssetValuation[]
  rollup:     PortfolioRollup
  ccy:        ReportingCcy
  loading:    boolean
}) {
  const sym = CCY_SYMBOL[ccy]

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><div className="text-[12px] text-ink-3">Loading DCI data…</div></div>
  }

  if (valuations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[12px] text-ink-3">Add assets in <strong>01 Portfolio Assets</strong> to model liability.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Aggregate Liability</p>
          <p className="text-[24px] font-semibold text-down tabular-nums mt-1">{fmt(rollup.liability_mid, sym)}</p>
          <p className="text-[10px] text-ink-4 mt-0.5">undiscounted, gross of NRO</p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Material Recovery (NRO)</p>
          <p className="text-[24px] font-semibold text-up tabular-nums mt-1">({fmt(rollup.nro_mid, sym)})</p>
          <p className="text-[10px] text-ink-4 mt-0.5">offset against liability</p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Net Obligation</p>
          <p className="text-[24px] font-semibold text-down tabular-nums mt-1">{fmt(rollup.net_obligation_mid, sym)}</p>
          <p className="text-[10px] text-ink-4 mt-0.5">range {fmt(rollup.net_obligation_low, sym)} – {fmt(rollup.net_obligation_high, sym)}</p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Present Value</p>
          <p className="text-[24px] font-semibold text-ink tabular-nums mt-1">{fmt(rollup.pv_total, sym)}</p>
          <p className="text-[10px] text-ink-4 mt-0.5">@ {rollup.discount_rate_pct}% discount</p>
        </div>
      </div>

      {/* Composition donuts (Chart I) */}
      <div className="grid grid-cols-3 gap-4">
        {(() => {
          const PALETTE = ['#0A1628','#007B8A','#1C3D52','#4A9BAA','#C4863A','#2A7F8E','#3D6E7A','#5A8A95','#6BAAB5','#9BB5BB']
          const countrySlices: DonutSlice[] = Object.entries(rollup.by_country)
            .sort((a, b) => b[1].net_mid - a[1].net_mid)
            .map(([cc, v], i) => ({ label: cc, value: v.net_mid, color: PALETTE[i % PALETTE.length] }))
          const classSlices: DonutSlice[] = Object.entries(rollup.by_class)
            .sort((a, b) => b[1].net_mid - a[1].net_mid)
            .map(([ac, v], i) => ({
              label: ASSET_CLASS_LABELS[ac as AssetClass] ?? ac,
              value: v.net_mid, color: PALETTE[i % PALETTE.length],
            }))
          // Retirement decade buckets
          const decadeMap = new Map<string, number>()
          for (const v of valuations) {
            const decade = `${Math.floor(v.retirement_year / 10) * 10}s`
            decadeMap.set(decade, (decadeMap.get(decade) ?? 0) + (v.net_obligation_mid ?? 0))
          }
          const decadeSlices: DonutSlice[] = Array.from(decadeMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([decade, value], i) => ({ label: decade, value, color: PALETTE[(i + 4) % PALETTE.length] }))
          return (
            <>
              <div className="bg-panel border border-border rounded-lg p-4">
                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-1">Net obligation by country</p>
                <MaterialDonut slices={countrySlices} total={rollup.net_obligation_mid}
                               currency={ccy} centerLabel="Total" height={220} />
              </div>
              <div className="bg-panel border border-border rounded-lg p-4">
                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-1">By asset class</p>
                <MaterialDonut slices={classSlices} total={rollup.net_obligation_mid}
                               currency={ccy} centerLabel="Total" height={220} />
              </div>
              <div className="bg-panel border border-border rounded-lg p-4">
                <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-1">By retirement decade</p>
                <MaterialDonut slices={decadeSlices} total={rollup.net_obligation_mid}
                               currency={ccy} centerLabel="Total" height={220} />
              </div>
            </>
          )
        })()}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-ink-2">By Country</p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Country</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">DCI Series</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Sites</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">MW</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Net Obl.</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rollup.by_country).sort((a, b) => b[1].net_mid - a[1].net_mid).map(([cc, v], i) => (
                <tr key={cc} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 font-semibold text-ink">{cc}</td>
                  <td className="px-4 py-2 text-ink-3 text-[11px]">{routeCountry(cc).series}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{v.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Math.round(v.mw)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-down font-semibold">{fmt(v.net_mid, sym)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-ink-2">By Asset Class</p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Class</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Sites</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">MW</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Net Obl.</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">% Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(rollup.by_class).sort((a, b) => b[1].net_mid - a[1].net_mid).map(([ac, v], i) => (
                <tr key={ac} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 font-semibold text-ink">{ASSET_CLASS_LABELS[ac as AssetClass]}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{v.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{Math.round(v.mw)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-down font-semibold">{fmt(v.net_mid, sym)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-3">
                    {rollup.net_obligation_mid > 0 ? `${((v.net_mid / rollup.net_obligation_mid) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[11px] font-semibold text-ink-2">Site-level breakdown</p>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-page">
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Site</th>
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Country</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">MW</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Liability</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">NRO</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Net Obl.</th>
              <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">PV</th>
            </tr>
          </thead>
          <tbody>
            {valuations.sort((a, b) => (b.net_obligation_mid ?? 0) - (a.net_obligation_mid ?? 0)).map((v, i) => (
              <tr key={v.asset.id} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                <td className="px-4 py-2 font-semibold text-ink">{v.asset.site_name}</td>
                <td className="px-4 py-2 text-ink-2">{v.asset.country_code}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-2">{v.asset.capacity_mw.toFixed(1)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-down">{fmt(v.liability_mid, sym)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-up">({fmt(v.nro_mid, sym)})</td>
                <td className="px-4 py-2 text-right tabular-nums text-down font-semibold">{fmt(v.net_obligation_mid, sym)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{fmt(v.pv_obligation, sym)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── 03 NRO Attribution ────────────────────────────────────────────────────────

function NroAttribution({ valuations, ccy }: { valuations: AssetValuation[]; ccy: ReportingCcy }) {
  const sym = CCY_SYMBOL[ccy]
  const grandTotal = valuations.reduce((s, v) => s + (v.nro_mid ?? 0), 0)

  // Aggregate by material across all assets
  const byMaterial: Record<string, number> = {}
  for (const v of valuations) {
    for (const a of v.nro_attribution) {
      byMaterial[a.material] = (byMaterial[a.material] ?? 0) + a.value_mid
    }
  }
  const materialRows = Object.entries(byMaterial).sort((a, b) => b[1] - a[1])

  if (valuations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[12px] text-ink-3">Add assets to compute NRO attribution.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Total NRO</p>
          <p className="text-[24px] font-semibold text-up tabular-nums mt-1">{fmt(grandTotal, sym)}</p>
          <p className="text-[10px] text-ink-4 mt-0.5">across {valuations.length} sites</p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-4 col-span-2">
          <p className="text-[11px] text-ink-2">
            NRO is the recoverable scrap value (steel, copper, aluminium) at end-of-life, net of merchant markup deductions and disposal costs.
            Attribution uses fleet-average LCA volumes — turbine-specific attribution available where the make/model is known.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-ink-2">By Material</p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Material</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">Value</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">% of NRO</th>
              </tr>
            </thead>
            <tbody>
              {materialRows.map(([m, v], i) => (
                <tr key={m} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 text-ink">{m.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-up font-semibold">{fmt(v, sym)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-3">
                    {grandTotal > 0 ? `${((v / grandTotal) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="text-[11px] font-semibold text-ink-2">By Site</p>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Site</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">MW</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">NRO</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold text-ink-3 uppercase">NRO/MW</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold text-ink-3 uppercase">Method</th>
              </tr>
            </thead>
            <tbody>
              {[...valuations].sort((a, b) => (b.nro_mid ?? 0) - (a.nro_mid ?? 0)).map((v, i) => (
                <tr key={v.asset.id} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-4 py-2 text-ink font-semibold">{v.asset.site_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">{v.asset.capacity_mw.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-up font-semibold">{fmt(v.nro_mid, sym)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-2">
                    {v.nro_mid != null && v.asset.capacity_mw > 0 ? fmt(v.nro_mid / v.asset.capacity_mw, sym) : '—'}
                  </td>
                  <td className="px-4 py-2 text-[10px] text-ink-3">{v.nro_method.replace(/_/g, ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── 04 IFRS IAS 37 Schedule ───────────────────────────────────────────────────

function IfrsSchedule({
  valuations, rollup, ccy, discountRate, onDiscountRateChange,
}: {
  valuations:           AssetValuation[]
  rollup:               PortfolioRollup
  ccy:                  ReportingCcy
  discountRate:         number
  onDiscountRateChange: (v: number) => void
}) {
  const sym = CCY_SYMBOL[ccy]

  if (valuations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[12px] text-ink-3">Add assets to generate the IFRS schedule.</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">

      <div className="bg-panel border border-border rounded-lg p-5 flex items-end gap-6">
        <div>
          <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Discount Rate (p.a.)</label>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={10} step={0.1}
                   value={discountRate}
                   onChange={e => onDiscountRateChange(parseFloat(e.target.value))}
                   className="w-48 accent-teal" />
            <span className="text-[16px] font-semibold text-ink tabular-nums w-16">{discountRate.toFixed(1)}%</span>
          </div>
          <p className="text-[10px] text-ink-4 mt-1">Risk-free rate or weighted average cost of capital — your choice per IAS 37.47</p>
        </div>
        <div className="ml-auto grid grid-cols-3 gap-6 text-right">
          <div>
            <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Present Value</p>
            <p className="text-[20px] font-semibold text-ink tabular-nums">{fmt(rollup.pv_total, sym)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Current Portion</p>
            <p className="text-[20px] font-semibold text-down tabular-nums">{fmt(rollup.current_portion, sym)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Annual Unwind</p>
            <p className="text-[20px] font-semibold text-highlight tabular-nums">{fmt(rollup.annual_unwind, sym)}</p>
          </div>
        </div>
      </div>

      <div className="bg-panel border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-[11px] font-semibold text-ink-2">IAS 37 Disclosure Schedule — site detail</p>
          <button onClick={() => downloadCsv('endenex_ifrs_schedule.csv', ifrsScheduleCsv(valuations, rollup))}
                  className="px-3 py-1 text-[10px] font-semibold text-teal border border-teal/40 rounded hover:bg-teal/10">
            Download CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border bg-page">
                <th className="px-3 py-2 text-left font-semibold text-ink-3 uppercase">Site</th>
                <th className="px-3 py-2 text-left font-semibold text-ink-3 uppercase">Country</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">MW</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">Comm.</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">Retires</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">n (yrs)</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">Net Obl.</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">PV</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">Current</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">Non-current</th>
                <th className="px-3 py-2 text-right font-semibold text-ink-3 uppercase">Unwind</th>
              </tr>
            </thead>
            <tbody>
              {[...valuations].sort((a, b) => (b.pv_obligation ?? 0) - (a.pv_obligation ?? 0)).map((v, i) => (
                <tr key={v.asset.id} className={`border-b border-border last:border-0 ${i % 2 === 1 ? 'bg-page/50' : ''}`}>
                  <td className="px-3 py-2 text-ink font-semibold">{v.asset.site_name}</td>
                  <td className="px-3 py-2 text-ink-2">{v.asset.country_code}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{v.asset.capacity_mw.toFixed(0)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{v.asset.commissioning_year}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{v.retirement_year}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-3">{v.years_to_retirement}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-down">{fmt(v.net_obligation_mid, sym)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink font-semibold">{fmt(v.pv_obligation, sym)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-down">{fmt(v.current_portion, sym)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">{fmt(v.non_current_portion, sym)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-highlight">{fmt(v.annual_unwind, sym)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink/20 bg-page font-semibold">
                <td className="px-3 py-2 text-ink">TOTAL</td>
                <td></td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{Math.round(rollup.total_capacity_mw)}</td>
                <td colSpan={3}></td>
                <td className="px-3 py-2 text-right tabular-nums text-down">{fmt(rollup.net_obligation_mid, sym)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{fmt(rollup.pv_total, sym)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-down">{fmt(rollup.current_portion, sym)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-2">{fmt(rollup.non_current_portion, sym)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-highlight">{fmt(rollup.annual_unwind, sym)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-page border border-border rounded-lg p-4">
        <p className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide mb-2">IAS 37 measurement basis</p>
        <p className="text-[11px] text-ink-2 leading-relaxed">
          Best estimate of expenditure required to settle present obligation at the reporting date (IAS 37.36).
          Where the time value of money is material, provisions are discounted using a pre-tax rate that reflects current market assessments
          of the time value of money and risks specific to the liability (IAS 37.45-47).
          Annual unwinding of the discount is recognised as a finance cost (IAS 37.60).
        </p>
      </div>
    </div>
  )
}

// ── 05 Sensitivity ────────────────────────────────────────────────────────────

function Scenarios({
  valuations, rollup, ccy,
}: {
  valuations: AssetValuation[]
  rollup:     PortfolioRollup
  ccy:        ReportingCcy
}) {
  const sym = CCY_SYMBOL[ccy]
  const [steelAdj,  setSteelAdj]  = useState(0)
  const [copperAdj, setCopperAdj] = useState(0)
  const [gateAdj,   setGateAdj]   = useState(0)
  const [timingAdj, setTimingAdj] = useState(0)
  const [discountAdj, setDiscountAdj] = useState(0)

  // Material shares of NRO (approximate, from typical fleet)
  const STEEL_SHARE = 0.62
  const COPPER_SHARE = 0.30
  const ALU_SHARE   = 0.08

  const nroAdjFactor =
    STEEL_SHARE  * (1 + steelAdj  / 100) +
    COPPER_SHARE * (1 + copperAdj / 100) +
    ALU_SHARE

  const liabAdjFactor = 1 + gateAdj / 100   // gate fees affect disposal cost which is in liability
  const timingFactor  = Math.pow(1.025, timingAdj)   // 2.5% per year cost inflation
  const discountAdjPp = discountAdj   // percentage points added to base discount rate

  const adjLiability  = rollup.liability_mid       * liabAdjFactor * timingFactor
  const adjNro        = rollup.nro_mid             * nroAdjFactor  * timingFactor
  const adjNet        = adjLiability - adjNro

  // Recompute PV with adjusted discount rate using portfolio average years
  const avgYears = valuations.length
    ? valuations.reduce((s, v) => s + v.years_to_retirement * v.asset.capacity_mw, 0) / rollup.total_capacity_mw
    : 0
  const newRate = (rollup.discount_rate_pct + discountAdjPp) / 100
  const adjPv   = newRate >= 0 ? adjNet / Math.pow(1 + newRate, avgYears) : adjNet

  const baseNet = rollup.net_obligation_mid
  const basePv  = rollup.pv_total
  const netDelta = adjNet - baseNet
  const pvDelta  = adjPv  - basePv

  const sliders: [string, number, (v: number) => void, number, number, string][] = [
    ['Steel scrap price',   steelAdj,  setSteelAdj,    -30, 30, '%'],
    ['Copper price',        copperAdj, setCopperAdj,   -30, 30, '%'],
    ['Blade gate fees',     gateAdj,   setGateAdj,     -30, 30, '%'],
    ['Timing offset',       timingAdj, setTimingAdj,    -5, 10, 'yr'],
    ['Discount rate Δ',     discountAdj, setDiscountAdj, -3,  3, 'pp'],
  ]

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">

      <div className="bg-panel border border-border rounded-lg p-5 space-y-5">
        <p className="text-[11px] font-semibold text-ink-2 uppercase tracking-wide">Adjust Assumptions</p>
        <div className="grid grid-cols-3 gap-x-10 gap-y-5">
          {sliders.map(([label, val, setter, min, max, unit]) => (
            <div key={label} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-ink-2">{label}</span>
                <span className={`text-[12px] font-semibold tabular-nums ${val > 0 ? 'text-down' : val < 0 ? 'text-up' : 'text-ink-3'}`}>
                  {val > 0 ? '+' : ''}{val}{unit}
                </span>
              </div>
              <input type="range" min={min} max={max} step={unit === 'yr' || unit === 'pp' ? 1 : 1}
                     value={val} onChange={e => setter(parseFloat(e.target.value))}
                     className="w-full accent-teal" />
              <div className="flex justify-between text-[9px] text-ink-4">
                <span>{min}{unit}</span><span>0</span><span>+{max}{unit}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={() => { setSteelAdj(0); setCopperAdj(0); setGateAdj(0); setTimingAdj(0); setDiscountAdj(0) }}
                  className="text-[11px] text-ink-3 hover:text-ink underline">Reset</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-panel border border-border rounded-lg p-5">
          <p className="text-[11px] font-semibold text-ink-2 uppercase tracking-wide mb-3">Net obligation impact</p>
          <div className="flex items-baseline gap-3">
            <span className="text-[24px] font-semibold text-down tabular-nums">{fmt(adjNet, sym)}</span>
            <span className="text-[11px] text-ink-3">adjusted</span>
          </div>
          <p className={`text-[12px] font-semibold mt-1 ${netDelta > 0 ? 'text-down' : netDelta < 0 ? 'text-up' : 'text-ink-3'}`}>
            {netDelta > 0 ? '+' : ''}{fmt(netDelta, sym)} vs base ({fmt(baseNet, sym)})
          </p>
        </div>
        <div className="bg-panel border border-border rounded-lg p-5">
          <p className="text-[11px] font-semibold text-ink-2 uppercase tracking-wide mb-3">Present value impact</p>
          <div className="flex items-baseline gap-3">
            <span className="text-[24px] font-semibold text-ink tabular-nums">{fmt(adjPv, sym)}</span>
            <span className="text-[11px] text-ink-3">@ {(rollup.discount_rate_pct + discountAdjPp).toFixed(1)}%</span>
          </div>
          <p className={`text-[12px] font-semibold mt-1 ${pvDelta > 0 ? 'text-down' : pvDelta < 0 ? 'text-up' : 'text-ink-3'}`}>
            {pvDelta > 0 ? '+' : ''}{fmt(pvDelta, sym)} vs base ({fmt(basePv, sym)})
          </p>
        </div>
      </div>

      <p className="text-[10px] text-ink-4">
        Indicative model. Material shares: steel 62%, copper 30%, aluminium 8%. Timing factor: 2.5%/yr cost inflation.
        Discount adjustment shifts the rate used for PV; portfolio-average years to retirement = {avgYears.toFixed(1)}.
      </p>
    </div>
  )
}

// ── 06 Investor Pack export ───────────────────────────────────────────────────

function ExportTab({
  assets, valuations, rollup, ccy,
}: {
  assets:     PortfolioAsset[]
  valuations: AssetValuation[]
  rollup:     PortfolioRollup
  ccy:        ReportingCcy
}) {
  const [organization, setOrganization] = useState('')
  const [preparedFor,  setPreparedFor]  = useState('')

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

  return (
    <div className="flex-1 overflow-auto p-5 space-y-5">

      <div className="bg-panel border border-border rounded-lg p-5 space-y-3">
        <p className="text-[11px] font-semibold text-ink-2 uppercase tracking-wide">Customise (optional)</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Organisation</label>
            <input className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                   value={organization} onChange={e => setOrganization(e.target.value)} placeholder="e.g. Acme Renewables Holdings Ltd" />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide block mb-1">Prepared for</label>
            <input className="w-full h-8 px-3 text-[12px] text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                   value={preparedFor} onChange={e => setPreparedFor(e.target.value)} placeholder="e.g. Audit Committee · 30 May 2026" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-panel border border-border rounded-lg p-5 flex flex-col">
          <p className="text-[12px] font-semibold text-ink mb-1">Board Memo</p>
          <p className="text-[11px] text-ink-3 mb-4">Print-ready HTML — opens in a new window. Press ⌘P / Ctrl-P → Save as PDF.</p>
          <ul className="text-[11px] text-ink-2 space-y-1 mb-4 list-disc list-inside">
            <li>Executive summary with PV, current portion, range</li>
            <li>Composition by country and asset class</li>
            <li>Top 10 sites by obligation</li>
            <li>Full IAS 37 disclosure schedule</li>
            <li>Methodology &amp; recommended actions</li>
          </ul>
          <button onClick={openBoardMemo} disabled={valuations.length === 0}
                  className="mt-auto px-4 py-2 text-[12px] font-semibold bg-teal text-white rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            Generate Board Memo →
          </button>
        </div>

        <div className="bg-panel border border-border rounded-lg p-5 flex flex-col">
          <p className="text-[12px] font-semibold text-ink mb-1">IFRS IAS 37 Schedule (CSV)</p>
          <p className="text-[11px] text-ink-3 mb-4">Auditor-ready disclosure schedule with PV, current/non-current split, annual unwind.</p>
          <ul className="text-[11px] text-ink-2 space-y-1 mb-4 list-disc list-inside">
            <li>One row per site with full IAS 37 columns</li>
            <li>Total row for portfolio rollup</li>
            <li>Methodology footer with rate and basis</li>
          </ul>
          <button onClick={downloadIfrs} disabled={valuations.length === 0}
                  className="mt-auto px-4 py-2 text-[12px] font-semibold bg-teal text-white rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            Download IFRS Schedule
          </button>
        </div>

        <div className="bg-panel border border-border rounded-lg p-5 flex flex-col">
          <p className="text-[12px] font-semibold text-ink mb-1">Surety Pack (CSV)</p>
          <p className="text-[11px] text-ink-3 mb-4">For surety underwriters and lenders — uses high-confidence figures for conservative bond sizing.</p>
          <ul className="text-[11px] text-ink-2 space-y-1 mb-4 list-disc list-inside">
            <li>Liability low / mid / high per site</li>
            <li>NRO low / mid / high</li>
            <li>Recommended bond amount (high estimate)</li>
          </ul>
          <button onClick={downloadSurety} disabled={valuations.length === 0}
                  className="mt-auto px-4 py-2 text-[12px] font-semibold bg-teal text-white rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
            Download Surety Pack
          </button>
        </div>

        <div className="bg-panel border border-border rounded-lg p-5 flex flex-col">
          <p className="text-[12px] font-semibold text-ink mb-1">Methodology Notes (Markdown)</p>
          <p className="text-[11px] text-ink-3 mb-4">Full DCI v1.0 formula, source attribution, IAS 37 construction notes.</p>
          <ul className="text-[11px] text-ink-2 space-y-1 mb-4 list-disc list-inside">
            <li>DCI Spot formula with all inputs</li>
            <li>Country routing rules</li>
            <li>NRO computation steps</li>
            <li>IAS 37 construction notes &amp; limitations</li>
          </ul>
          <button onClick={downloadMethod}
                  className="mt-auto px-4 py-2 text-[12px] font-semibold text-teal border border-teal/40 rounded hover:bg-teal/10">
            Download Methodology
          </button>
        </div>

        <div className="bg-panel border border-border rounded-lg p-5 flex flex-col col-span-2">
          <p className="text-[12px] font-semibold text-ink mb-1">Raw Portfolio CSV</p>
          <p className="text-[11px] text-ink-3 mb-4">Your portfolio in import-compatible format — useful for transferring between accounts or environments.</p>
          <button onClick={downloadCsvAssets} disabled={assets.length === 0}
                  className="self-start px-4 py-2 text-[12px] font-semibold text-teal border border-teal/40 rounded hover:bg-teal/10 disabled:opacity-40 disabled:cursor-not-allowed">
            Download Portfolio CSV
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PortfolioPage ─────────────────────────────────────────────────────────────

export function PortfolioPage() {
  const [tab, setTab]                 = useState<SubTab>('assets')
  const [assets, setAssets]           = useState<PortfolioAsset[]>(() => loadPortfolio())
  const [reportingCcy, setReportingCcy] = useState<ReportingCcy>('EUR')
  const [discountRate, setDiscountRate] = useState<number>(4.5)

  const [dciByS, setDciByS]         = useState<Partial<Record<DciSnapshot['series'], DciSnapshot>>>({})
  const [nroByMR, setNroByMR]       = useState<Map<string, NroSnapshot>>(new Map())
  const [lcaByModel, setLcaByModel] = useState<Map<string, TurbineLcaRow[]>>(new Map())
  const [fxRates, setFxRates]       = useState<FxRate[]>([])
  const [countryMults, setCountryMults] = useState<CountryMultipliers[]>([])
  const [loading, setLoading]       = useState(true)

  // Persist on every change
  useEffect(() => { savePortfolio(assets) }, [assets])

  // Fetch live reference data on mount
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const [dciRes, nroRes, lcaRes, fxRes, multRes] = await Promise.all([
          supabase.from('dci_publications')
            .select('series, publication_date, index_value, net_liability, net_liability_low, net_liability_high, currency, methodology_version')
            .eq('is_published', true)
            .order('publication_date', { ascending: false }),
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

        // Latest per series
        const dci: Partial<Record<DciSnapshot['series'], DciSnapshot>> = {}
        for (const row of (dciRes.data ?? []) as DciSnapshot[]) {
          if (!dci[row.series]) dci[row.series] = row
        }
        setDciByS(dci)

        // Latest per material × region
        const nro = new Map<string, NroSnapshot>()
        for (const row of (nroRes.data ?? []) as NroSnapshot[]) {
          const key = `${row.material_type}|${row.region}`
          if (!nro.has(key)) nro.set(key, row)
        }
        setNroByMR(nro)

        // Group LCA rows by make|model
        const lca = new Map<string, TurbineLcaRow[]>()
        for (const row of (lcaRes.data ?? []) as TurbineLcaRow[]) {
          const key = `${row.turbine_make}|${row.turbine_model}`
          const arr = lca.get(key) ?? []
          arr.push(row)
          lca.set(key, arr)
        }
        setLcaByModel(lca)

        // Latest per quote currency
        const fxLatest = new Map<string, FxRate>()
        for (const row of (fxRes.data ?? []) as FxRate[]) {
          if (!fxLatest.has(row.quote_currency)) fxLatest.set(row.quote_currency, row)
        }
        setFxRates(Array.from(fxLatest.values()))

        // Country cost multipliers (one row per country)
        setCountryMults((multRes.data ?? []) as CountryMultipliers[])
      } catch {
        // fail silently; UI shows '—'
      }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  // Compute valuations (v1.1 — applies country multipliers per asset)
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
  const loadSample  = useCallback(() => {
    const sample = loadSampleAssets().map(a => ({ ...a, id: uid() }))
    setAssets(sample)
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Module header */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-panel flex items-center gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-widest text-ink-3 uppercase">PORTFOLIO ANALYTICS</p>
          <p className="text-[12px] text-ink-3">Liability exposure modelling, NRO attribution, and IFRS-grade disclosure across your asset portfolio</p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-ink-3 uppercase tracking-wide">Reporting</span>
            <select className="h-7 px-2 text-[11px] font-semibold text-ink bg-page border border-border rounded focus:outline-none focus:border-teal"
                    value={reportingCcy}
                    onChange={e => setReportingCcy(e.target.value as ReportingCcy)}>
              <option value="EUR">EUR €</option>
              <option value="USD">USD $</option>
              <option value="GBP">GBP £</option>
            </select>
          </div>
          <span className="text-[10px] font-semibold text-teal bg-teal/10 border border-teal/20 px-2 py-0.5 rounded-full uppercase tracking-wide">
            {assets.length} site{assets.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Sub-tab nav */}
      <SubTabNav active={tab} onChange={setTab} />

      {/* Content */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-page">
        {tab === 'assets'    && <AssetsTab     assets={assets} onAdd={addAsset} onUpdate={updateAsset} onDelete={deleteAsset} onLoadSample={loadSample} />}
        {tab === 'liability' && <LiabilityModel valuations={valuations} rollup={rollup} ccy={reportingCcy} loading={loading} />}
        {tab === 'nro'       && <NroAttribution valuations={valuations} ccy={reportingCcy} />}
        {tab === 'ifrs'      && <IfrsSchedule   valuations={valuations} rollup={rollup} ccy={reportingCcy} discountRate={discountRate} onDiscountRateChange={setDiscountRate} />}
        {tab === 'scenarios' && <Scenarios      valuations={valuations} rollup={rollup} ccy={reportingCcy} />}
        {tab === 'export'    && <ExportTab      assets={assets} valuations={valuations} rollup={rollup} ccy={reportingCcy} />}
      </div>
    </div>
  )
}
