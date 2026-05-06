// ── Top chrome ───────────────────────────────────────────────────────────────
// Deep navy strip — wordmark + 5-index ticker + global session clocks.
// BNEF light theme: navy strip pinned at top.

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface DciTick {
  series:           string
  index_value:      number | null
  net_liability:    number | null
  currency:         string
  publication_date: string
}

const WIND_SERIES = ['dci_wind_europe', 'dci_wind_north_america'] as const

const TICKER_CONFIG: {
  key:    string
  label:  string
  ccy:    string
  series: string | null
}[] = [
  { key: 'dci_wind_eu',  label: 'WIND·EU',   ccy: '€', series: 'dci_wind_europe'         },
  { key: 'dci_wind_na',  label: 'WIND·NA',   ccy: '$', series: 'dci_wind_north_america'  },
  { key: 'dci_solar_eu', label: 'SOLAR·EU',  ccy: '€', series: null                      },
  { key: 'dci_solar_na', label: 'SOLAR·NA',  ccy: '$', series: null                      },
  { key: 'dci_solar_jp', label: 'SOLAR·JP',  ccy: '¥', series: null                      },
]

function fmtNet(val: number | null, ccy: string): string {
  if (val == null) return '—'
  if (Math.abs(val) >= 1000) return `${ccy}${Math.round(val / 1000)}k`
  return `${ccy}${Math.round(val)}`
}

function fmtIdx(val: number | null): string {
  if (val == null) return '—'
  return val.toFixed(2)
}

function useUtcClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function fmtCity(now: Date, tz: string): string {
  return now.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false,
  })
}

const CITIES = [
  { code: 'LDN', tz: 'Europe/London' },
  { code: 'FRA', tz: 'Europe/Berlin' },
  { code: 'NYC', tz: 'America/New_York' },
  { code: 'TYO', tz: 'Asia/Tokyo' },
]

export function TopChrome() {
  const [latestByS, setLatestByS] = useState<Record<string, DciTick>>({})
  const [priorByS,  setPriorByS]  = useState<Record<string, DciTick>>({})
  const now = useUtcClock()

  const fetchDci = async () => {
    try {
      const { data } = await supabase
        .from('dci_publications')
        .select('series, index_value, net_liability, currency, publication_date')
        .in('series', WIND_SERIES as unknown as string[])
        .eq('is_published', true)
        .order('publication_date', { ascending: false })
        .limit(4)

      if (!data) return

      const latest: Record<string, DciTick> = {}
      const prior:  Record<string, DciTick> = {}

      for (const row of data as DciTick[]) {
        if (!latest[row.series])     latest[row.series] = row
        else if (!prior[row.series]) prior[row.series]  = row
      }

      setLatestByS(latest)
      setPriorByS(prior)
    } catch {/* silent */}
  }

  useEffect(() => {
    fetchDci()
    const id = setInterval(fetchDci, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  // Build the ticker items array (rendered twice for seamless loop)
  const tickerItems = TICKER_CONFIG.map(item => {
    const tick  = item.series ? latestByS[item.series] : null
    const prior = item.series ? priorByS[item.series]  : null
    const live  = tick != null && tick.net_liability != null
    const delta = live && prior?.net_liability
      ? ((tick.net_liability! - prior.net_liability) / Math.abs(prior.net_liability)) * 100
      : null
    return { ...item, tick, prior, live, delta }
  })

  const renderTickerItem = (item: typeof tickerItems[0], keySuffix: string) => (
    <div key={`${item.key}-${keySuffix}`} className="flex items-baseline gap-1.5 flex-shrink-0 px-5">
      <span className="text-[11px] font-semibold tracking-[0.08em] text-chrome-muted">
        {item.label}
      </span>
      <span className="text-[13px] font-semibold text-chrome-text tabular-nums">
        {item.live ? `${fmtNet(item.tick!.net_liability, item.ccy)}/MW` : '—'}
      </span>
      {item.delta != null && Math.abs(item.delta) >= 0.05 && (
        <span className={`text-[11px] font-semibold tabular-nums ${item.delta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
          {item.delta > 0 ? '▲' : '▼'}{Math.abs(item.delta).toFixed(1)}%
        </span>
      )}
      <span className="text-chrome-border ml-3">·</span>
    </div>
  )

  return (
    <div className="flex-shrink-0 h-11 bg-chrome-bg border-b border-chrome-border flex items-center px-3 gap-3 select-none">

      {/* Logo (enlarged, no wordmark) */}
      <div className="flex items-center flex-shrink-0">
        <img
          src="/logo-white.png"
          alt="Endenex"
          className="h-6 w-auto opacity-95"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      </div>

      <div className="w-px h-5 bg-chrome-border flex-shrink-0" />

      {/* Scrolling ticker tape */}
      <div className="flex-1 min-w-0 overflow-hidden ticker-mask">
        <div className="ticker-track">
          {tickerItems.map(it => renderTickerItem(it, 'a'))}
          {tickerItems.map(it => renderTickerItem(it, 'b'))}
        </div>
      </div>

      <div className="w-px h-5 bg-chrome-border flex-shrink-0" />

      {/* World clocks */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        {CITIES.map(c => (
          <div key={c.code} className="flex items-baseline gap-1">
            <span className="text-[10px] text-chrome-muted tracking-wide">{c.code}</span>
            <span className="text-[11.5px] text-chrome-text tabular-nums font-medium">{fmtCity(now, c.tz)}</span>
          </div>
        ))}
      </div>

    </div>
  )
}
