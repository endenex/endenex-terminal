// ── Chart N + O — Geographic asset map + choropleth (light) ────────────────

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
  country_code: string
  value:        number
  label:        string
}

const ISO2_TO_NUMERIC: Record<string, string> = {
  GB: '826', DE: '276', FR: '250', ES: '724', IT: '380', NL: '528', PL: '616',
  DK: '208', SE: '752', NO: '578', FI: '246', PT: '620', BE: '056', AT: '040',
  IE: '372', US: '840', CA: '124', MX: '484', JP: '392', AU: '036', CN: '156',
  IN: '356', BR: '076', AR: '032', CL: '152', ZA: '710',
}

function eolColour(eol: number | null, today: number): string {
  if (eol === null) return '#98A1AE'
  if (eol < today)        return '#C73838'
  if (eol <= today + 5)   return '#D97706'
  if (eol <= today + 10)  return '#0E7A86'
  return '#0A5C66'
}

function choroplethColour(v: number, max: number): string {
  if (v <= 0 || max <= 0) return '#F4F6F9'
  const intensity = Math.min(v / max, 1)
  // Light teal scale
  const r = Math.round(228 - intensity * 214)
  const g = Math.round(241 - intensity * 119)
  const b = Math.round(243 - intensity * 109)
  return `rgb(${r},${g},${b})`
}

export function WorldAssetMap({
  pins = [], metrics = [], mode = 'dots', height = 380,
}: {
  pins?:    AssetPin[]
  metrics?: CountryMetric[]
  mode?:    'dots' | 'choropleth'
  height?:  number
}) {
  const [hoverPin, setHoverPin] = useState<AssetPin | null>(null)
  const [hoverCountry, setHoverCountry] = useState<{ name: string; value?: number } | null>(null)
  const todayYear = new Date().getFullYear()

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
        style={{ width: '100%', height: '100%', background: '#F2F4F7' }}
      >
        <ZoomableGroup center={[10, 30]} zoom={1.2}>
          <Geographies geography={TOPO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const numId = String(geo.id)
                const metric = mode === 'choropleth' ? metricByNumeric.get(numId) : undefined
                const fill = metric ? choroplethColour(metric.value, maxMetric) : '#FFFFFF'
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#D6DBE0"
                    strokeWidth={0.4}
                    onMouseEnter={() => setHoverCountry({
                      name:  (geo as { properties?: { name?: string } }).properties?.name ?? '',
                      value: metric?.value,
                    })}
                    onMouseLeave={() => setHoverCountry(null)}
                    style={{
                      default: { outline: 'none' },
                      hover:   { outline: 'none', fill: metric ? '#0E7A86' : '#E4F1F3' },
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
                strokeWidth={0.5}
                opacity={0.9}
                onMouseEnter={() => setHoverPin(pin)}
                onMouseLeave={() => setHoverPin(null)}
                style={{ cursor: 'pointer' }}
              />
            </Marker>
          ))}
        </ZoomableGroup>
      </ComposableMap>

      {(hoverPin || hoverCountry) && (
        <div className="absolute top-1.5 left-1.5 bg-panel border border-border rounded-sm px-2 py-1 text-[11.5px] pointer-events-none shadow-panel-float">
          {hoverPin && (
            <>
              <p className="font-semibold text-ink">{hoverPin.site_name ?? '(unnamed)'}</p>
              <p className="text-ink-3">{hoverPin.country_code} · {hoverPin.asset_class.replace(/_/g,' ')}</p>
              {hoverPin.capacity_mw != null && <p className="text-ink-2 tabular-nums">{hoverPin.capacity_mw.toFixed(1)} MW</p>}
              {hoverPin.eol_year != null && <p className="text-ink-3">EOL {hoverPin.eol_year}</p>}
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

      <div className="absolute bottom-1.5 left-1.5 bg-panel border border-border rounded-sm px-2 py-1 text-[10.5px] flex items-center gap-2">
        {mode === 'dots' ? (
          <>
            <span className="font-semibold text-ink-3 uppercase tracking-wide">EOL</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-down inline-block" />past</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:'#D97706'}} />≤5y</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:'#0E7A86'}} />5-10y</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{background:'#0A5C66'}} />&gt;10y</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-ink-3 uppercase tracking-wide">Density</span>
            <span className="text-ink-4">low</span>
            <div className="w-20 h-1.5 rounded-sm" style={{ background: 'linear-gradient(to right, #E4F1F3, #0E7A86)' }} />
            <span className="text-ink-4">high</span>
          </>
        )}
      </div>
    </div>
  )
}
