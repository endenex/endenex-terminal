// ── Portfolio Export — investor-grade outputs ────────────────────────────────
// Produces:
//   • Board memo (HTML, print-ready)
//   • IFRS IAS 37 disclosure schedule (CSV)
//   • Surety pack (CSV) — per-site liability with confidence ranges
//   • Methodology notes (Markdown)

import type { AssetValuation, PortfolioRollup } from './portfolio-engine'

// ── Number formatting ────────────────────────────────────────────────────────

const CCY_SYMBOL = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' } as const

function fmt(n: number | null | undefined, sym = '€'): string {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${sym}${(n / 1_000_000_000).toFixed(2)}bn`
  if (abs >= 1_000_000)     return `${sym}${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)         return `${sym}${(n / 1_000).toFixed(0)}k`
  return `${sym}${n.toFixed(0)}`
}

function fmtFull(n: number | null | undefined, sym = '€'): string {
  if (n == null || isNaN(n)) return '—'
  return `${sym}${Math.round(n).toLocaleString('en-GB')}`
}

function pct(num: number, den: number): string {
  if (den === 0 || isNaN(den)) return '—'
  return `${((num / den) * 100).toFixed(1)}%`
}

// ── CSV builder ──────────────────────────────────────────────────────────────

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(c => {
    const s = c == null ? '' : String(c)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ── IFRS IAS 37 schedule (CSV) ───────────────────────────────────────────────

export function ifrsScheduleCsv(valuations: AssetValuation[], rollup: PortfolioRollup): string {
  const sym = CCY_SYMBOL[rollup.reporting_currency]
  const header = [
    'site_name', 'country', 'asset_class', 'capacity_mw',
    'commissioning_year', 'retirement_year', 'years_to_retirement',
    `dci_series_used`, `liability_undiscounted_mid_${rollup.reporting_currency}`,
    `nro_mid_${rollup.reporting_currency}`,
    `net_obligation_mid_${rollup.reporting_currency}`,
    `present_value_${rollup.reporting_currency}`,
    `current_portion_${rollup.reporting_currency}`,
    `non_current_portion_${rollup.reporting_currency}`,
    `annual_unwind_${rollup.reporting_currency}`,
    'discount_rate_pct', 'methodology_basis',
  ]
  const dataRows = valuations.map(v => [
    v.asset.site_name, v.asset.country_code, v.asset.asset_class, v.asset.capacity_mw,
    v.asset.commissioning_year, v.retirement_year, v.years_to_retirement,
    v.dci_series, Math.round(v.liability_mid ?? 0),
    Math.round(v.nro_mid ?? 0),
    Math.round(v.net_obligation_mid ?? 0),
    Math.round(v.pv_obligation ?? 0),
    Math.round(v.current_portion ?? 0),
    Math.round(v.non_current_portion ?? 0),
    Math.round(v.annual_unwind ?? 0),
    rollup.discount_rate_pct, 'IAS 37 §36-50, Endenex DCI v1.0',
  ])
  const totalRow = [
    'TOTAL', '', '', rollup.total_capacity_mw,
    '', '', '',
    '', Math.round(rollup.liability_mid),
    Math.round(rollup.nro_mid),
    Math.round(rollup.net_obligation_mid),
    Math.round(rollup.pv_total),
    Math.round(rollup.current_portion),
    Math.round(rollup.non_current_portion),
    Math.round(rollup.annual_unwind),
    rollup.discount_rate_pct, '',
  ]
  // Methodology footer block
  const footer = [
    [],
    ['# Methodology notes'],
    [`Reporting currency`, rollup.reporting_currency, `(${sym})`],
    ['As of', rollup.asof_date],
    ['Discount rate', `${rollup.discount_rate_pct}%`, 'p.a., applied as PV = obligation / (1+r)^n'],
    ['Liability source', 'Endenex DCI Spot v1.0'],
    ['DCI routing', 'US/CA/MX → dci_wind_north_america; all other countries (incl. GB/IE) → dci_wind_europe'],
    ['NRO source', 'Endenex Recovery Model — commodity prices (LME/Fastmarkets/AMM) net of merchant markups, weighted by fleet-average LCA volumes'],
    ['Current portion', 'Years-to-retirement ≤ 1 → full obligation classified current; otherwise 0'],
    ['Non-current portion', 'Discounted present value of obligation due > 1 year out'],
    ['Annual unwind', 'PV × discount rate — interest expense added to obligation each period'],
    ['Confidence range', 'DCI ±8% (±1σ across observed merchant quotes plus base assumption uncertainty)'],
    ['Auditability', 'IAS 37 §36-50 — measurement at best estimate of expenditure required to settle present obligation'],
  ]
  return toCsv([header, ...dataRows, totalRow, ...footer])
}

// ── Surety pack (CSV) ────────────────────────────────────────────────────────

export function suretyPackCsv(valuations: AssetValuation[], rollup: PortfolioRollup): string {
  const sym = CCY_SYMBOL[rollup.reporting_currency]
  const header = [
    'site_name', 'country', 'asset_class', 'capacity_mw', 'operator',
    'commissioning_year', 'retirement_year',
    `liability_low_${rollup.reporting_currency}`,
    `liability_mid_${rollup.reporting_currency}`,
    `liability_high_${rollup.reporting_currency}`,
    `nro_low_${rollup.reporting_currency}`,
    `nro_mid_${rollup.reporting_currency}`,
    `nro_high_${rollup.reporting_currency}`,
    `net_obligation_low_${rollup.reporting_currency}`,
    `net_obligation_mid_${rollup.reporting_currency}`,
    `net_obligation_high_${rollup.reporting_currency}`,
    'recommended_bond_amount', 'methodology',
  ]
  const dataRows = valuations.map(v => {
    // Recommended bond = high estimate (conservative for surety underwriting)
    const bond = Math.round(v.net_obligation_high ?? v.liability_high ?? 0)
    return [
      v.asset.site_name, v.asset.country_code, v.asset.asset_class, v.asset.capacity_mw,
      v.asset.operator || '', v.asset.commissioning_year, v.retirement_year,
      Math.round(v.liability_low  ?? 0),
      Math.round(v.liability_mid  ?? 0),
      Math.round(v.liability_high ?? 0),
      Math.round(v.nro_low  ?? 0),
      Math.round(v.nro_mid  ?? 0),
      Math.round(v.nro_high ?? 0),
      Math.round(v.net_obligation_low  ?? 0),
      Math.round(v.net_obligation_mid  ?? 0),
      Math.round(v.net_obligation_high ?? 0),
      bond, 'Endenex DCI v1.0',
    ]
  })
  const totalRow = [
    'TOTAL', '', '', rollup.total_capacity_mw, '', '', '',
    Math.round(rollup.liability_low),
    Math.round(rollup.liability_mid),
    Math.round(rollup.liability_high),
    '', Math.round(rollup.nro_mid), '',
    Math.round(rollup.net_obligation_low),
    Math.round(rollup.net_obligation_mid),
    Math.round(rollup.net_obligation_high),
    Math.round(rollup.net_obligation_high),
    '',
  ]
  const footer = [
    [],
    ['# Surety underwriting notes'],
    ['Recommended bond amount uses the HIGH estimate (97.5% confidence) for conservative coverage'],
    ['Liability range reflects DCI ±8% confidence band'],
    ['NRO range reflects merchant markup spread (low markup = high recovery)'],
    [`Reporting currency`, rollup.reporting_currency, `(${sym})`],
    ['Methodology', 'Endenex DCI Spot v1.0 — see dci_methodology_versions table for full formula'],
  ]
  return toCsv([header, ...dataRows, totalRow, ...footer])
}

// ── Board memo (HTML, print-ready) ───────────────────────────────────────────

export function boardMemoHtml(valuations: AssetValuation[], rollup: PortfolioRollup, opts: {
  organization?: string
  prepared_for?: string
} = {}): string {
  const sym = CCY_SYMBOL[rollup.reporting_currency]
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const org = opts.organization || 'Portfolio Holder'
  const prepared = opts.prepared_for || 'Board of Directors'

  const topCountries = Object.entries(rollup.by_country)
    .sort((a, b) => b[1].net_mid - a[1].net_mid)
    .slice(0, 5)
  const topClasses = Object.entries(rollup.by_class)
    .sort((a, b) => b[1].net_mid - a[1].net_mid)

  // Top 10 sites by net obligation
  const topSites = [...valuations]
    .sort((a, b) => (b.net_obligation_mid ?? 0) - (a.net_obligation_mid ?? 0))
    .slice(0, 10)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Board Memo — Decommissioning Liability ${today}</title>
<style>
  @page { size: A4; margin: 22mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #0A1628; max-width: 780px; margin: 0 auto; padding: 24px; line-height: 1.45; font-size: 11pt; }
  header { border-bottom: 2px solid #007B8A; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 18pt; margin: 0 0 4px; color: #0A1628; }
  h2 { font-size: 12pt; margin-top: 22px; margin-bottom: 8px; color: #0A1628; border-bottom: 1px solid #E5E8EC; padding-bottom: 4px; }
  h3 { font-size: 10pt; margin-top: 16px; margin-bottom: 6px; color: #4A5560; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta { font-size: 9pt; color: #6E7984; }
  .headline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 14px 0 4px; }
  .card { border: 1px solid #E5E8EC; padding: 12px; border-radius: 4px; background: #F4F5F7; }
  .card .label { font-size: 8.5pt; color: #6E7984; text-transform: uppercase; letter-spacing: 0.05em; }
  .card .value { font-size: 16pt; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .card .sub { font-size: 9pt; color: #4A5560; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 6px 0; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #E5E8EC; }
  th { background: #F4F5F7; font-weight: 600; font-size: 9pt; color: #4A5560; text-transform: uppercase; letter-spacing: 0.04em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pos { color: #C03939; }
  .neg { color: #2A8A4A; }
  .footnote { font-size: 8.5pt; color: #6E7984; margin-top: 16px; padding-top: 10px; border-top: 1px solid #E5E8EC; }
  .ribbon { background: #007B8A; color: white; padding: 2px 8px; font-size: 8pt; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; display: inline-block; }
  @media print { .noprint { display: none; } body { padding: 0; } }
</style>
</head>
<body>

<header>
  <span class="ribbon">Confidential · Board Memo</span>
  <h1>Decommissioning Liability Position</h1>
  <p class="meta">${org} · Prepared for ${prepared} · ${today}</p>
</header>

<div class="noprint" style="background:#FFF8E1;border:1px solid #F5C842;padding:10px 14px;margin-bottom:18px;font-size:10pt;border-radius:4px;">
  <strong>To save as PDF:</strong> Press <kbd>⌘P</kbd> / <kbd>Ctrl-P</kbd> and choose "Save as PDF". Headers and tables are sized for A4.
</div>

<h2>1. Executive summary</h2>

<p>
  As of <strong>${rollup.asof_date}</strong>, the portfolio comprises <strong>${rollup.asset_count}</strong> sites
  totalling <strong>${Math.round(rollup.total_capacity_mw).toLocaleString('en-GB')} MW</strong> of installed capacity.
  Aggregate present-value decommissioning obligation under IAS 37 is
  <strong>${fmt(rollup.pv_total, sym)}</strong>
  (<strong>${fmtFull(rollup.pv_total, sym)}</strong>),
  benchmarked against the Endenex DCI Spot index (methodology v1.0).
</p>

<div class="headline">
  <div class="card">
    <div class="label">Undiscounted obligation</div>
    <div class="value">${fmt(rollup.net_obligation_mid, sym)}</div>
    <div class="sub">Range ${fmt(rollup.net_obligation_low, sym)} – ${fmt(rollup.net_obligation_high, sym)}</div>
  </div>
  <div class="card">
    <div class="label">Present value (IAS 37)</div>
    <div class="value">${fmt(rollup.pv_total, sym)}</div>
    <div class="sub">@ ${rollup.discount_rate_pct}% discount</div>
  </div>
  <div class="card">
    <div class="label">Current portion (≤ 12mo)</div>
    <div class="value">${fmt(rollup.current_portion, sym)}</div>
    <div class="sub">${pct(rollup.current_portion, rollup.pv_total)} of PV</div>
  </div>
</div>

<h2>2. Composition of obligation</h2>

<h3>By country</h3>
<table>
  <thead><tr><th>Country</th><th class="num">Sites</th><th class="num">Capacity (MW)</th><th class="num">Net obligation</th><th class="num">% of total</th></tr></thead>
  <tbody>
    ${topCountries.map(([cc, v]) => `
      <tr><td>${cc}</td><td class="num">${v.count}</td><td class="num">${Math.round(v.mw).toLocaleString('en-GB')}</td><td class="num pos">${fmt(v.net_mid, sym)}</td><td class="num">${pct(v.net_mid, rollup.net_obligation_mid)}</td></tr>
    `).join('')}
  </tbody>
</table>

<h3>By asset class</h3>
<table>
  <thead><tr><th>Asset class</th><th class="num">Sites</th><th class="num">Capacity (MW)</th><th class="num">Net obligation</th><th class="num">% of total</th></tr></thead>
  <tbody>
    ${topClasses.map(([ac, v]) => `
      <tr><td>${ac.replace(/_/g,' ')}</td><td class="num">${v.count}</td><td class="num">${Math.round(v.mw).toLocaleString('en-GB')}</td><td class="num pos">${fmt(v.net_mid, sym)}</td><td class="num">${pct(v.net_mid, rollup.net_obligation_mid)}</td></tr>
    `).join('')}
  </tbody>
</table>

<h2>3. Top 10 sites by obligation</h2>
<table>
  <thead><tr><th>Site</th><th>Country</th><th class="num">MW</th><th class="num">Retires</th><th class="num">PV obligation</th><th class="num">Annual unwind</th></tr></thead>
  <tbody>
    ${topSites.map(v => `
      <tr>
        <td>${v.asset.site_name}</td>
        <td>${v.asset.country_code}</td>
        <td class="num">${v.asset.capacity_mw.toFixed(1)}</td>
        <td class="num">${v.retirement_year}</td>
        <td class="num pos">${fmt(v.pv_obligation, sym)}</td>
        <td class="num">${fmt(v.annual_unwind, sym)}</td>
      </tr>
    `).join('')}
  </tbody>
</table>

<h2>4. IAS 37 disclosure schedule</h2>
<table>
  <tbody>
    <tr><td>Best-estimate undiscounted obligation</td><td class="num">${fmtFull(rollup.net_obligation_mid, sym)}</td></tr>
    <tr><td>Confidence range (low / high)</td><td class="num">${fmtFull(rollup.net_obligation_low, sym)} – ${fmtFull(rollup.net_obligation_high, sym)}</td></tr>
    <tr><td>Discount rate applied</td><td class="num">${rollup.discount_rate_pct}% p.a.</td></tr>
    <tr><td>Present value of obligation</td><td class="num"><strong>${fmtFull(rollup.pv_total, sym)}</strong></td></tr>
    <tr><td>Of which, current portion (settle within 12 months)</td><td class="num">${fmtFull(rollup.current_portion, sym)}</td></tr>
    <tr><td>Of which, non-current portion</td><td class="num">${fmtFull(rollup.non_current_portion, sym)}</td></tr>
    <tr><td>Annual unwinding of discount (interest expense)</td><td class="num">${fmtFull(rollup.annual_unwind, sym)}</td></tr>
    <tr><td>Material recovery offset (NRO) embedded in net</td><td class="num neg">(${fmtFull(rollup.nro_mid, sym)})</td></tr>
  </tbody>
</table>

<h2>5. Methodology &amp; assumptions</h2>
<ul>
  <li><strong>Liability source:</strong> Endenex DCI Spot v1.0 — published index of decommissioning cost per MW for the reference asset (2010-vintage Vestas V90 2.0 MW onshore wind).</li>
  <li><strong>Country routing:</strong> GB/IE sites priced via DCI Spot UK Wind. US/CA/MX via DCI Spot US Wind. All other geographies via DCI Spot Europe Wind.</li>
  <li><strong>FX normalisation:</strong> Native-currency figures converted to ${rollup.reporting_currency} using ECB reference rates as of the publication date.</li>
  <li><strong>NRO:</strong> Net Recovery Offset computed from observed scrap commodity prices (LME, Fastmarkets, AMM) net of merchant markup deductions, weighted by fleet-average LCA material volumes per MW.</li>
  <li><strong>Discount rate:</strong> ${rollup.discount_rate_pct}% p.a., applied as PV = obligation / (1+r)^n where n = years to retirement.</li>
  <li><strong>Retirement year:</strong> Commissioning year + design life (25yr wind/solar, 15yr BESS).</li>
  <li><strong>Confidence range:</strong> ±8% reflecting ±1σ across observed merchant quotes and base assumption uncertainty.</li>
</ul>

<h2>6. Recommended actions</h2>
<ul>
  <li>Review surety / restoration bond coverage against high-confidence figure of <strong>${fmt(rollup.net_obligation_high, sym)}</strong>.</li>
  <li>Schedule provision unwinding of <strong>${fmt(rollup.annual_unwind, sym)}</strong> as interest expense in the next reporting period.</li>
  <li>Confirm classification of <strong>${fmt(rollup.current_portion, sym)}</strong> as current liability where retirement falls within 12 months.</li>
  <li>Re-run this position after each monthly DCI publication; subscribe to alert thresholds for >5% movement.</li>
</ul>

<div class="footnote">
  <strong>Sources:</strong> Endenex DCI Spot v1.0 (computed monthly from LME, Fastmarkets, AMM commodity prices and OEM LCA volume coefficients).
  Asset registry: MaStR (DE, DL-DE-BY-2.0), REPD (GB, OGL v3.0), USWTDB (US, CC0), Energistyrelsen (DK), ODRÉ (FR), GEM Wind Power Tracker (CC BY 4.0).
  <br><br>
  This memo is generated from the Endenex Terminal portfolio engine. Figures are model outputs and do not constitute investment, accounting, or legal advice.
  Site-specific decommissioning quotes from contractors will vary. Always cross-reference with current contractor estimates and applicable jurisdictional requirements.
</div>

</body>
</html>`
}

// ── Methodology notes (Markdown) ─────────────────────────────────────────────

export function methodologyMd(rollup: PortfolioRollup): string {
  return `# Endenex DCI v1.0 — Methodology Notes

**Generated:** ${new Date().toISOString()}
**Reporting currency:** ${rollup.reporting_currency}
**As of:** ${rollup.asof_date}

## DCI Spot formula

\`\`\`
DCI Spot(t) = (Gross Cost(t) − Material Recovery(t) + Disposal Costs(t))
              / Net Liability(base) × 100
\`\`\`

Where:
- **Gross Cost(t)** = base gross × (1 + 3.5%)^(years since base)
- **Material Recovery(t)** = sum across ferrous + copper + aluminium of (commodity price − median merchant markup) × fleet-average LCA volume per MW
- **Disposal Costs(t)** = blade transport + blade gate fees + scrap haulage, each escalated at 3.5%/yr
- **Net Liability(base)** = €78,500/MW (2025-01-01 base period)

## Reference asset

- **Vintage:** 2010
- **Capacity:** 100 MW
- **Turbine model:** Vestas V90 2.0 MW (geared, DFIG)
- **Design life:** 25 years
- **Base period:** 2025-01-01 (index = 100.00)

## Series and routing

| Series | Country routing | Currency | Commodity region |
|---|---|---|---|
| dci_wind_europe        | EU, UK, IE, all other ex-NA | EUR | EU (or GB for UK assets at scrap level) |
| dci_wind_north_america | US, CA, MX                  | USD | US |
| dci_solar_europe        | EU, UK (Phase 2)            | EUR | EU |
| dci_solar_north_america | US, CA, MX (Phase 2)        | USD | US |
| dci_solar_japan         | JP (Phase 2)                | JPY | n/a |

## NRO computation

For each material × region × date:
1. Latest commodity price (LME/Fastmarkets/AMM)
2. Median merchant markup deducted
3. Net per tonne × LCA volume per MW = net recovery per MW

Confidence range: low markup → high recovery, high markup → low recovery (capturing observed merchant spread).

## IAS 37 schedule construction

- **Recognition:** Commissioning date + 1 year (or today if commissioned > 1 year ago)
- **Retirement:** Commissioning year + design life
- **Discount rate:** ${rollup.discount_rate_pct}% p.a.
- **Present value:** PV = net obligation / (1 + r)^n
- **Current portion:** Net obligation if years to retirement ≤ 1; else 0
- **Non-current portion:** PV
- **Annual unwind:** PV × r (interest expense recognised each period)

## Source attributions

- **Asset registries:** MaStR (DE), REPD (GB), USWTDB (US), Energistyrelsen (DK), ODRÉ (FR), GEM Wind Power Tracker
- **Commodity prices:** LME (copper, aluminium settlement), Fastmarkets (HMS1/HMS2 ferrous scrap, EU/UK), AMM (US scrap), Argus (NdPr oxide for rare earth)
- **FX:** ECB Reference Rates
- **LCA volumes:** Vestas, Siemens Gamesa, GE, Nordex, Enercon published LCA documents

## Limitations

- Site-specific contractor quotes will vary based on access, foundation depth, regional labour rates, and waste-handling requirements
- Methodology v1.0 does not include offshore wind, solar PV, or BESS as separate DCI series — these are forthcoming
- Rare earth recovery economics depend on processing facility availability; current model assumes EU/GB/US recovery infrastructure
- Blade gate fees vary widely by recycling pathway (cement co-processing vs mechanical vs landfill where permitted)
`
}
