// ── Bottom utility footer ───────────────────────────────────────────────────
// Status bar — clock, market sessions, methodology, account.

import { useState, useEffect } from 'react'
import { useClerk } from '@clerk/clerk-react'
import { supabase } from '@/lib/supabase'
import { DataHealthOverlay } from '@/components/overlays/DataHealthOverlay'
import { MethodologyOverlay } from '@/components/overlays/MethodologyOverlay'
import { DciPublicationOverlay } from '@/components/overlays/DciPublicationOverlay'

interface Session {
  label:    string
  openUTC:  number
  closeUTC: number
  days:     number[]
}

const SESSIONS: Session[] = [
  { label: 'LME',    openUTC: 11 + 40 / 60, closeUTC: 17,    days: [1, 2, 3, 4, 5] },
  { label: 'COMEX',  openUTC: 13.5,         closeUTC: 18,    days: [1, 2, 3, 4, 5] },
  { label: 'EEX',    openUTC: 7,            closeUTC: 17,    days: [1, 2, 3, 4, 5] },
  { label: 'TOCOM',  openUTC: 0,            closeUTC: 6.5,   days: [1, 2, 3, 4, 5] },
]

function isOpen(s: Session, now: Date): boolean {
  const day = now.getUTCDay()
  const dec = now.getUTCHours() + now.getUTCMinutes() / 60
  return s.days.includes(day) && dec >= s.openUTC && dec < s.closeUTC
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
  })
}

/**
 * Tracks "when did our sync pipeline last successfully complete".
 *
 * Earlier version asked watch_events.updated_at — but if Airtable had
 * no changed rows on a given day, no watch_events.updated_at got
 * touched even though sync_airtable_watch ran fine. Result: STALE
 * indicator on a quiet day.
 *
 * Better signal: the most recent SUCCESSFUL ingestion_runs row from
 * any of the daily-pipeline jobs. That tracks "did the sync run",
 * not "did data change". Threshold = 36h (1.5x daily cadence) so
 * we don't false-alarm on overnight timezone edges.
 */
type FeedState = 'loading' | 'live' | 'stale' | 'error'

interface FeedSync {
  state:    FeedState
  lastSync: string | null
}

function useFeedSync(): FeedSync {
  const [feed, setFeed] = useState<FeedSync>({ state: 'loading', lastSync: null })
  useEffect(() => {
    supabase.from('ingestion_runs')
      .select('finished_at')
      .eq('status', 'success')
      .in('pipeline', [
        'sync_airtable_watch',  // primary signal — Airtable feed
        'sync_uswtdb',           // fallback — daily USWTDB sync
        'compute_dci',           // fallback — daily DCI publication
        'fetch_fx_rates',        // fallback — daily ECB FX rates
      ])
      .order('finished_at', { ascending: false })
      .limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          // Network blip / RLS edge / timeout — distinguish from
          // "actually stale" so we don't false-alarm.
          console.warn('[feed-sync] query failed:', error.message)
          setFeed({ state: 'error', lastSync: null })
          return
        }
        const ts = (data?.finished_at as string | undefined) ?? null
        if (!ts) {
          setFeed({ state: 'stale', lastSync: null })
          return
        }
        // 36h tolerates timezone edges (browser-local vs UTC) and
        // some pipeline-run variance, while still catching genuine
        // multi-day outages.
        const hoursStale = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60)
        setFeed({ state: hoursStale < 36 ? 'live' : 'stale', lastSync: ts })
      })
  }, [])
  return feed
}

// Dot colours match the existing "OK = emerald" convention used by the
// market-session indicators (LME / COMEX / EEX / TOCOM). Teal read as
// blue against the chrome background and broke the at-a-glance "is it
// healthy?" scan.
const FEED_STYLES: Record<FeedState, { dot: string; text: string; label: string }> = {
  loading: { dot: 'bg-chrome-border',  text: 'text-chrome-muted', label: 'FEED …' },
  live:    { dot: 'bg-emerald-400',    text: 'text-chrome-text',  label: 'FEED LIVE' },
  stale:   { dot: 'bg-amber-bright',   text: 'text-amber-bright', label: 'FEED STALE' },
  error:   { dot: 'bg-chrome-border',  text: 'text-chrome-muted', label: 'FEED ?' },
}

export function BottomFooter() {
  const { signOut } = useClerk()
  const [overlay, setOverlay] = useState<null | 'health' | 'methodology' | 'dci-publication'>(null)
  const now  = useClock()
  const feed = useFeedSync()
  const fs   = FEED_STYLES[feed.state]

  return (
    <>
      <footer className="flex-shrink-0 h-7 bg-chrome-bg border-t border-chrome-border flex items-center justify-between px-3 select-none text-[10.5px]">

        {/* Left — clock + market sessions */}
        <div className="flex items-center gap-3">
          <span className="text-chrome-text tabular-nums font-medium">{fmtClock(now)}</span>
          <span className="text-chrome-muted">UTC</span>
          <span className="w-px h-3 bg-chrome-border" />
          {SESSIONS.map(s => {
            const open = isOpen(s, now)
            return (
              <span key={s.label} className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${open ? 'bg-emerald-400' : 'bg-chrome-border'}`} />
                <span className={open ? 'text-chrome-text' : 'text-chrome-muted'}>{s.label}</span>
              </span>
            )
          })}
          <span className="w-px h-3 bg-chrome-border" />
          <span
            className="flex items-center gap-1"
            title={
              feed.state === 'loading' ? 'Checking feed sync…' :
              feed.state === 'live'    ? `Feed live · last sync ${feed.lastSync}` :
              feed.state === 'stale'   ? (feed.lastSync ? `No fresh sync since ${feed.lastSync}` : 'No successful sync recorded') :
                                          'Feed-sync check failed (network / RLS) — see browser console'
            }
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${fs.dot}`} />
            <span className={fs.text}>{fs.label}</span>
          </span>
        </div>

        {/* Right — actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setOverlay('methodology')}
            className="text-chrome-muted hover:text-chrome-text uppercase tracking-wide font-semibold transition-colors"
          >
            Method <span className="text-chrome-muted">v1.1</span>
          </button>
          <button
            onClick={() => setOverlay('dci-publication')}
            className="text-chrome-muted hover:text-chrome-text uppercase tracking-wide font-semibold transition-colors"
          >
            DCI Publication
          </button>
          <span className="w-px h-3 bg-chrome-border" />
          <button
            onClick={() => setOverlay('health')}
            className="text-chrome-muted hover:text-chrome-text uppercase tracking-wide font-semibold transition-colors"
          >
            Coverage
          </button>
          {/* Alerts placeholder removed 2026-05-10 — button had no
              onClick + dot was hardcoded amber, so it always read as
              "you have alerts" without any actual alert system behind it.
              Re-add when the alert subsystem (watch-event triggers,
              threshold breaches, scheduled-report failures) is wired up. */}
          <button className="text-chrome-muted hover:text-chrome-text uppercase tracking-wide font-semibold transition-colors">
            Account
          </button>
          <button
            onClick={() => signOut()}
            className="text-chrome-muted hover:text-chrome-text uppercase tracking-wide font-semibold transition-colors"
          >
            Logout
          </button>
        </div>

      </footer>

      {overlay === 'health'          && <DataHealthOverlay     onClose={() => setOverlay(null)} />}
      {overlay === 'methodology'     && <MethodologyOverlay    onClose={() => setOverlay(null)} />}
      {overlay === 'dci-publication' && <DciPublicationOverlay onClose={() => setOverlay(null)} />}
    </>
  )
}
