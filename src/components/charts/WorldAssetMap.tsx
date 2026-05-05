// ── Chart N + O — Geographic asset map + choropleth ────────────────────────
// react-simple-maps based world map. Two modes:
//   mode='dots'        — pin each asset (lat/lon) coloured by EOL year
//   mode='choropleth'  — shade countries by aggregate metric (e.g. GW reaching EOL)
//
// World topojson loaded from CDN (~200KB cached). No tile server needed.

import { useState, useMemo } from 'react'
import {
  ComposableMap, Geographies, Geography, Marker, ZoomableGroup,
} from 'react-simple-maps'

const TOPO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

export interface AssetPin {
  id:           string
  site_name:    string | null
  country_code: string
  lat:          number
  lon:          number
  capacity_mw:  number | null
  eol_year:     number | null
  asset_class:  string
}

export interface CountryMetric {
  country_code: string   // ISO alpha-2 (we'll map to ISO numeric inside)
  value:        number
  label:        string
}

// ISO alpha-2 → numeric (for choropleth matching against world-atlas country IDs)
const ISO2_TO_NUMERIC: Record<string, string> = {
  GB: '826', DE: '276', FR: '250', ES: '724', IT: '380', NL: '528', PL: '616',
  DK: '208', SE: '752', NO: '578', FI: '246', PT: '620', BE: '056', AT: '040',
  IE: '372', US: '840', CA: '124', MX: '484', JP: '392', AU: '036', CN: '156',
  IN: '356', BR: '076', AR: '032', CL: '152', ZA: '710',
}

function eolColour(eol: number | null, today: number): string {
  if (eol === null) return '#9BB5BB'
  if (eol < today)        return '#C03939'   // past
  if (eol <= today + 5)   return '#E89C2C'   // near
  if (eol <= today + 10)  return '#3D8A9A'   // mid
  return '#5A8A95'                            // far
}

function choroplethColour(v: number, max: number): string {
  if (v <= 0 || max <= 0) return '#F4F5F7'
  const intensity = Math.min(v / max, 1)
  // Teal scale
  const r = Math.round(180 - intensity * 173)
  const g = Math.round(220 - intensity * 97)
  const b = Math.round(220 - intensity * 82)
  return `rgb(${r},${g},${b})`
}

export function WorldAssetMap({
  pins = [], metrics = [], mode = 'dots', height = 480,
}: {
  pins?:    AssetPin[]
  metrics?: CountryMetric[]
  mode?:    'dots' | 'choropleth'
  height?:  number
}) {
  const [hoverPin, setHoverPin] = useState<AssetPin | null>(null)
  const [hoverCountry, setHoverCountry] = useState<{ name: string; value?: number } | null>(null)
  const todayYear = new Date().getFullYear()

  // Map numeric ID → metric (for choropleth)
  const metricByNumeric = useMemo(() => {
    const m = new Map<string, CountryMetric>()
    for (const x of metrics) {
      const num = ISO2_TO_NUMERIC[x.country_code]
      if (num) m.set(num, x)
    }
    return m
  }, [metrics])

  const maxMetric = Math.max(0, ...metrics.map(m => m.value))

  return (
    <div className="relative" style={{ height }}>
      <ComposableMap
        projectionConfig={{ scale: 150 }}
        width={900} height={height}
        style={{ width: '100%', height: '100%', background: '#F4F5F7' }}
      >
        <ZoomableGroup center={[10, 30]} zoom={1.2}>
          <Geographies geography={TOPO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const numId = String(geo.id)
                const metric = mode === 'choropleth' ? metricByNumeric.get(numId) : undefined
                const fill = metric
                  ? choroplethColour(metric.value, maxMetric)
                  : '#FFFFFF'
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#E5E8EC"
                    strokeWidth={0.4}
                    onMouseEnter={() => setHoverCountry({
                      name:  (geo as { properties?: { name?: string } }).properties?.name ?? '',
                      value: metric?.value,
                    })}
                    onMouseLeave={() => setHoverCountry(null)}
                    style={{
                      default: { outline: 'none' },
                      hover:   { outline: 'none', fill: metric ? '#007B8A' : '#E5E8EC' },
                      pressed: { outline: 'none' },
                    }}
                  />
                )
              })
            }
          </Geographies>

          {mode === 'dots' && pins.map(pin => (
            <Marker key={pin.id} coordinates={[pin.lon, pin.lat]}>
              <circle
                r={pin.capacity_mw ? Math.max(2, Math.min(7, Math.log(pin.capacity_mw + 1) * 1.6)) : 2.5}
                fill={eolColour(pin.eol_year, todayYear)}
                stroke="#FFFFFF"
                strokeWidth={0.4}
                opacity={0.85}
                onMouseEnter={() => setHoverPin(pin)}
                onMouseLeave={() => setHoverPin(null)}
                style={{ cursor: 'pointer' }}
              />
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltip overlay */}
      {(hoverPin || hoverCountry) && (
        <div className="absolute top-2 left-2 bg-panel border border-border rounded shadow px-3 py-2 text-[11px] pointer-events-none">
          {hoverPin && (
            <>
              <p className="font-semibold text-ink">{hoverPin.site_name ?? '(unnamed)'}</p>
              <p className="text-ink-3">{hoverPin.country_code} · {hoverPin.asset_class.replace(/_/g,' ')}</p>
              {hoverPin.capacity_mw != null && <p className="text-ink-2">{hoverPin.capacity_mw.toFixed(1)} MW</p>}
              {hoverPin.eol_year != null && <p className="text-ink-3">EOL year: {hoverPin.eol_year}</p>}
            </>
          )}
          {hoverCountry && !hoverPin && (
            <>
              <p className="font-semibold text-ink">{hoverCountry.name || '—'}</p>
              {hoverCountry.value != null && <p className="text-ink-2 tabular-nums">{hoverCountry.value.toFixed(2)}</p>}
            </>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-2 left-2 bg-panel border border-border rounded shadow px-3 py-2 text-[10px] flex items-center gap-3">
        {mode === 'dots' ? (
          <>
            <span className="font-semibold text-ink-3 uppercase tracking-wide">EOL Horizon</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-down inline-block" /> past</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{background:'#E89C2C'}} /> ≤5y</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{background:'#3D8A9A'}} /> 5-10y</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{background:'#5A8A95'}} /> &gt;10y</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-ink-3 uppercase tracking-wide">Density</span>
            <span className="text-ink-3">low</span>
            <div className="w-24 h-2 rounded" style={{ background: 'linear-gradient(to right, #DCE2DD, #007B8A)' }} />
            <span className="text-ink-3">high</span>
          </>
        )}
      </div>
    </div>
  )
}
