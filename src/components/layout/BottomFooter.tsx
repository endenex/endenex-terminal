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

function useFeedSync() {
  const [lastSync, setLastSync] = useState<string | null>(null)
  useEffect(() => {
    supabase.from('watch_events')
      .select('updated_at').order('updated_at', { ascending: false })
      .limit(1).single()
      .then(({ data }) => { if (data?.updated_at) setLastSync(data.updated_at as string) })
  }, [])
  return lastSync
}

export function BottomFooter() {
  const { signOut } = useClerk()
  const [overlay, setOverlay] = useState<null | 'health' | 'methodology'>(null)
  const now      = useClock()
  const lastSync = useFeedSync()
  const synced   = lastSync && new Date(lastSync).toDateString() === new Date().toDateString()

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
          <button className="text-chrome-muted hover:text-chrome-text uppercase tracking-wide font-semibold transition-colors flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-bright inline-block" />
            Alerts
          </button>
          <span className="w-px h-3 bg-chrome-border" />
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
