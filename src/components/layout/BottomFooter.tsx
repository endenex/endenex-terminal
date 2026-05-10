// ── Bottom utility footer ───────────────────────────────────────────────────
// Status bar — clock, market sessions, methodology, account.

import { useState, useEffect } from 'react'
import { useClerk } from '@clerk/clerk-react'
import { supabase } from '@/lib/supabase'
import { DataHealthOverlay } from '@/components/overlays/DataHealthOverlay'
import { MethodologyOverlay } from '@/components/overlays/MethodologyOverlay'

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
function useFeedSync() {
  const [lastSync, setLastSync] = useState<string | null>(null)
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
      .then(({ data }) => { if (data?.finished_at) setLastSync(data.finished_at as string) })
  }, [])
  return lastSync
}

export function BottomFooter() {
  const { signOut } = useClerk()
  const [overlay, setOverlay] = useState<null | 'health' | 'methodology'>(null)
  const now      = useClock()
  const lastSync = useFeedSync()
  // Threshold: 36h tolerates timezone edges (browser-local vs UTC) and
  // some pipeline-run variance, while still catching genuine multi-day
  // outages.
  const hoursStale = lastSync
    ? (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60)
    : Infinity
  const synced = hoursStale < 36

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
          <span className="flex items-center gap-1" title="Endenex feed sync (daily 06:00 UTC)">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${synced ? 'bg-teal-bright' : 'bg-amber-bright'}`} />
            <span className={synced ? 'text-chrome-text' : 'text-amber-bright'}>
              {synced ? 'FEED LIVE' : 'FEED STALE'}
            </span>
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

      {overlay === 'health'      && <DataHealthOverlay  onClose={() => setOverlay(null)} />}
      {overlay === 'methodology' && <MethodologyOverlay onClose={() => setOverlay(null)} />}
    </>
  )
}
