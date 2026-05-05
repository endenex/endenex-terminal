// ── Top chrome ───────────────────────────────────────────────────────────────
// Dark navy strip — brand wordmark + five DCI index ticker.
// Spec: Product Brief v1.0 §5.1
//
// Wired to dci_publications for europe_wind and us_wind.
// Solar series are placeholders until those DCI series are published.

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DciTick {
  series:           string
  index_value:      number | null
  net_liability:    number | null
  currency:         string
  publication_date: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WIND_SERIES = ['europe_wind', 'us_wind'] as const

const TICKER_CONFIG: {
  key:    string
  label:  string
  ccy:    string
  series: string | null       // null = placeholder until schema exists
}[] = [
  { key: 'dci_wind_eu',  label: 'DCI WIND EU',   ccy: '€', series: 'europe_wind' },
  { key: 'dci_wind_na',  label: 'DCI WIND NA',   ccy: '$', series: 'us_wind'     },
  { key: 'dci_solar_eu', label: 'DCI SOLAR EU',  ccy: '€', series: null          },
  { key: 'dci_solar_na', label: 'DCI SOLAR NA',  ccy: '$', series: null          },
  { key: 'dci_solar_jp', label: 'DCI SOLAR JP',  ccy: '¥', series: null          },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtNetLiability(val: number | null, ccy: string): string {
  if (val == null) return '—'
  const sym = ccy
  // round to nearest £/€/$k and show as e.g. €42k
  if (Math.abs(val) >= 1000) {
    return `${sym}${Math.round(val / 1000)}k`
  }
  return `${sym}${Math.round(val)}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TopChrome() {
  const [latestByS, setLatestByS] = useState<Record<string, DciTick>>({})
  const [priorByS,  setPriorByS]  = useState<Record<string, DciTick>>({})

  const fetchDci = async () => {
    try {
      const { data } = await supabase
        .from('dci_publications')
        .select('series, index_value, net_liability, currency, publication_date')
        .in('series', WIND_SERIES as unknown as string[])
        .eq('is_published', true)
        .order('publication_date', { ascending: false })
        .limit(4)   // 2 per series (latest + prior)

      if (!data) return

      const latest: Record<string, DciTick> = {}
      const prior:  Record<string, DciTick> = {}

      for (const row of data as DciTick[]) {
        if (!latest[row.series])       latest[row.series] = row
        else if (!prior[row.series])   prior[row.series]  = row
      }

      setLatestByS(latest)
      setPriorByS(prior)
    } catch {
      // fail silently — ticker shows '—' if unavailable
    }
  }

  useEffect(() => {
    fetchDci()
    const id = setInterval(fetchDci, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex-shrink-0 h-10 bg-chrome-bg border-b border-chrome-border flex items-center px-5 gap-5 select-none">

      {/* Wordmark */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <img src="/logo-white.png" alt="Endenex" className="h-3.5 w-auto" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        <span className="text-[11px] font-bold tracking-[0.12em] uppercase" style={{ color: '#14A4B4' }}>
          TERMINAL
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-chrome-border flex-shrink-0" />

      {/* Five-index ticker */}
      <div className="flex items-center gap-6 overflow-x-auto min-w-0">
        {TICKER_CONFIG.map(item => {
          const tick  = item.series ? latestByS[item.series] : null
          const prior = item.series ? priorByS[item.series]  : null

          const isLive = tick != null && tick.net_liability != null
          const delta  = isLive && prior?.net_liability
            ? ((tick.net_liability! - prior.net_liability) / Math.abs(prior.net_liability)) * 100
            : null

          return (
            <div key={item.key} className="flex items-baseline gap-1.5 flex-shrink-0">
              <span className="text-[10px] font-semibold tracking-wider text-chrome-muted">
                {item.label}
              </span>
              <span className="text-[12px] font-semibold text-chrome-text tabular-nums">
                {isLive ? fmtNetLiability(tick.net_liability, item.ccy) : '—'}
              </span>
              {isLive && (
                <span className="text-[9.5px] text-chrome-muted">/MW</span>
              )}
              {delta != null && Math.abs(delta) >= 0.05 && (
                <span className={`text-[10px] font-semibold ${delta > 0 ? 'text-down' : 'text-up'}`}>
                  {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(1)}%
                </span>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
