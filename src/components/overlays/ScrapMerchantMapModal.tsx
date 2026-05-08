// ── Scrap Merchant Network Map (modal overlay) ────────────────────────────
//
// Leaflet-based interactive map with marker clustering. Pins coloured by
// operator status, sized by capacity bucket. Tile provider: CartoDB Positron
// (clean grey/white, minimal labels, no flag overlays).
//
// Coordinates come from a precomputed lookup (src/data/scrap_plant_coords.json).
// 80% viewport modal triggered from the Metal Scrap Merchants panel.

import { useState, useMemo, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import coordsTable from '@/data/scrap_plant_coords.json'

const COORDS = coordsTable as unknown as Record<string, [number, number]>

const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '' // Cartodb attribution intentionally suppressed for clean look

export interface MapPlant {
  city:      string
  country:   string
  specialty?: string
}

export interface MapOperator {
  id:               number
  name:             string
  parent_company:   string | null
  hq_country:       string | null
  offtaker_type:    string
  intake_capacity_kt_year: number | null
  status:           string | null
  website:          string | null
  plants:           MapPlant[] | null
  plant_count:      number | null
}

interface PinData {
  key:      string
  lat:      number
  lon:      number
  city:     string
  country:  string
  specialty: string | null
  operator: MapOperator
}

const STATUS_FILL: Record<string, string> = {
  active:              '#0B7285',
  pending_acquisition: '#B45309',
  distressed:          '#C73838',
  defunct:             '#9CA3AF',
}

function pinRadius(capacity: number | null): number {
  if (capacity == null) return 5
  if (capacity >= 2000) return 9
  if (capacity >=  500) return 7
  return 5
}

const fmtCapacity = (kt: number | null) => {
  if (kt == null) return '—'
  if (kt >= 1000) return `${(kt / 1000).toFixed(1)} Mt/yr`
  return `${kt} kt/yr`
}

export function ScrapMerchantMapModal({
  operators, country, onClose,
}: {
  operators: MapOperator[]
  country:   string             // current country filter from the panel ('ALL' or ISO-2)
  onClose:   () => void
}) {
  const [typeFilter,   setTypeFilter]   = useState<'ALL' | 'merchant' | 'integrated'>('ALL')
  const [selectedOp,   setSelectedOp]   = useState<number | null>(null)

  const mapDivRef    = useRef<HTMLDivElement | null>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const clusterRef   = useRef<L.MarkerClusterGroup | null>(null)

  // Lock background scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Build flat pin list
  const pins: PinData[] = useMemo(() => {
    const out: PinData[] = []
    for (const op of operators) {
      if (typeFilter !== 'ALL' && op.offtaker_type !== typeFilter) continue
      if (country !== 'ALL') {
        const matchPlant = (op.plants ?? []).some(p => p.country === country)
        const matchHq    = op.hq_country === country
        if (!matchPlant && !matchHq) continue
      }
      for (const p of op.plants ?? []) {
        const xy = COORDS[`${p.city}|${p.country}`]
        if (!xy) continue
        out.push({
          key:       `${op.id}|${p.city}|${p.country}`,
          lat:       xy[0],
          lon:       xy[1],
          city:      p.city,
          country:   p.country,
          specialty: p.specialty ?? null,
          operator:  op,
        })
      }
    }
    return out
  }, [operators, country, typeFilter])

  const visibleOps = useMemo(() => {
    const seen = new Set<number>()
    const list: MapOperator[] = []
    for (const p of pins) {
      if (seen.has(p.operator.id)) continue
      seen.add(p.operator.id)
      list.push(p.operator)
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [pins])

  // Initial map view
  const initialView = useMemo<{ center: L.LatLngExpression; zoom: number }>(() => {
    if (country === 'US')   return { center: [39, -98], zoom: 4 }
    if (country === 'ASIA') return { center: [30, 120], zoom: 4 }
    if (country !== 'ALL')  return { center: [50,  10], zoom: 5 }
    return                       { center: [47,   4], zoom: 4 }
  }, [country])

  // Initialise the Leaflet map once
  useEffect(() => {
    if (!mapDivRef.current) return
    if (mapRef.current) return

    const map = L.map(mapDivRef.current, {
      center: initialView.center,
      zoom:   initialView.zoom,
      zoomControl: true,
      attributionControl: false,
      worldCopyJump: false,
    })
    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map)

    const cluster = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom:   true,
      maxClusterRadius:    50,
    }) as L.MarkerClusterGroup
    map.addLayer(cluster)

    mapRef.current     = map
    clusterRef.current = cluster

    return () => {
      map.remove()
      mapRef.current     = null
      clusterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh markers whenever the pin set changes
  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster) return
    cluster.clearLayers()

    for (const pin of pins) {
      const op   = pin.operator
      const fill = STATUS_FILL[op.status ?? 'active'] ?? STATUS_FILL.active
      const r    = pinRadius(op.intake_capacity_kt_year)
      const isHi = selectedOp === op.id

      const marker = L.circleMarker([pin.lat, pin.lon], {
        radius:      isHi ? r + 2 : r,
        color:       '#FFFFFF',
        weight:      isHi ? 1.6 : 1,
        fillColor:   fill,
        fillOpacity: isHi ? 0.95 : 0.78,
      })

      const statusBadge = op.status && op.status !== 'active'
        ? `<span style="background:#FEF3C7;color:#92400E;padding:0 4px;border-radius:2px;font-size:9px;font-weight:700;text-transform:uppercase;margin-left:4px;">${op.status === 'pending_acquisition' ? 'M&A' : op.status}</span>`
        : ''
      const websiteHref = op.website
        ? `<a href="${op.website}" target="_blank" rel="noreferrer" style="color:#0B7285;text-decoration:none;font-weight:600;">${escapeHtml(op.name)}</a>`
        : `<span style="font-weight:600;">${escapeHtml(op.name)}</span>`
      marker.bindPopup(
        `<div style="font-size:11px;line-height:14px;min-width:180px;">
           <div style="margin-bottom:2px;">${websiteHref}${statusBadge}</div>
           ${op.parent_company ? `<div style="color:#6B7280;font-size:9.5px;margin-bottom:3px;">${escapeHtml(op.parent_company)}</div>` : ''}
           <div style="color:#111827;margin-bottom:1px;">${escapeHtml(pin.city)}, ${pin.country}</div>
           ${pin.specialty ? `<div style="color:#6B7280;font-style:italic;font-size:10px;margin-bottom:2px;">${escapeHtml(pin.specialty)}</div>` : ''}
           <div style="color:#6B7280;font-size:9.5px;text-transform:capitalize;">${op.offtaker_type} · ${fmtCapacity(op.intake_capacity_kt_year)}</div>
         </div>`,
        { closeButton: true, autoClose: false, maxWidth: 260 },
      )
      cluster.addLayer(marker)
    }
  }, [pins, selectedOp])

  // Recentre when country filter changes
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.setView(initialView.center, initialView.zoom, { animate: true })
  }, [country, initialView])

  // When sidebar selection changes, fly to that operator's pin cluster
  useEffect(() => {
    if (!mapRef.current || selectedOp == null) return
    const opPins = pins.filter(p => p.operator.id === selectedOp)
    if (opPins.length === 0) return
    if (opPins.length === 1) {
      mapRef.current.setView([opPins[0].lat, opPins[0].lon], 8, { animate: true })
    } else {
      const bounds = L.latLngBounds(opPins.map(p => [p.lat, p.lon] as L.LatLngTuple))
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 7 })
    }
  }, [selectedOp, pins])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
         onClick={onClose}>
      <div className="bg-panel border border-border rounded-sm shadow-xl flex flex-col overflow-hidden"
           style={{ width: '80vw', height: '80vh' }}
           onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex-shrink-0 h-9 px-3 flex items-center justify-between border-b border-border bg-titlebar">
          <div className="flex items-center gap-2 min-w-0">
            <span className="label-xs">SMI</span>
            <span className="text-ink-4 text-[10px]">·</span>
            <span className="text-[12.5px] font-semibold text-ink">Metal Scrap Merchants — Network</span>
            <span className="text-[10px] text-ink-3">{visibleOps.length} operators · {pins.length} plants</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center bg-canvas border border-border rounded-sm p-px">
              {(['ALL', 'merchant', 'integrated'] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                        className={clsx(
                          'px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded-sm capitalize',
                          typeFilter === t ? 'bg-active text-teal' : 'text-ink-3 hover:text-ink',
                        )}>
                  {t === 'ALL' ? 'All' : t}
                </button>
              ))}
            </div>
            <button onClick={onClose}
                    className="px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink bg-canvas border border-border rounded-sm">
              Close ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex">
          {/* Sidebar */}
          <div className="w-64 flex-shrink-0 border-r border-border overflow-auto bg-canvas/30">
            {visibleOps.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-ink-3 text-center">No operators in view.</div>
            ) : (
              <ul>
                {visibleOps.map(op => {
                  const opPinCount = pins.filter(p => p.operator.id === op.id).length
                  const isSelected = selectedOp === op.id
                  return (
                    <li key={op.id}
                        onClick={() => setSelectedOp(isSelected ? null : op.id)}
                        className={clsx(
                          'px-2.5 py-1 border-b border-border/60 cursor-pointer text-[11px]',
                          isSelected ? 'bg-active/40' : 'hover:bg-raised',
                        )}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink font-semibold truncate">{op.name}</span>
                        <span className="text-ink-4 text-[10px] tabular-nums flex-shrink-0">{opPinCount}</span>
                      </div>
                      <div className="text-ink-3 text-[9.5px] truncate">{op.parent_company ?? '—'}</div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Leaflet map container */}
          <div ref={mapDivRef} className="flex-1 min-w-0" style={{ background: '#F8FAFC' }} />
        </div>
      </div>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}
