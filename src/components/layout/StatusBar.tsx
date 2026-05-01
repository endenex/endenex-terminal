import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── Commodity exchange sessions (UTC) ──────────────────────────────────────────
// Approximate open hours for pricing publications relevant to Recovery Value.

interface Session {
  label:    string
  openUTC:  number   // decimal hours, e.g. 11.67 = 11:40
  closeUTC: number
  days:     number[] // 1=Mon … 5=Fri
  title:    string   // tooltip
}

const SESSIONS: Session[] = [
  {
    label:    'LME',
    title:    'London Metal Exchange — Ring trading 11:40–17:00 UTC',
    openUTC:  11 + 40 / 60,
    closeUTC: 17,
    days:     [1, 2, 3, 4, 5],
  },
  {
    label:    'Fastmarkets',
    title:    'Fastmarkets — European price assessments',
    openUTC:  8,
    closeUTC: 17,
    days:     [1, 2, 3, 4, 5],
  },
  {
    label:    'CME',
    title:    'CME COMEX — US metals pit session 13:30–18:00 UTC',
    openUTC:  13.5,
    closeUTC: 18,
    days:     [1, 2, 3, 4, 5],
  },
]

function isSessionOpen(s: Session, now: Date): boolean {
  const day     = now.getUTCDay()
  const decimal = now.getUTCHours() + now.getUTCMinutes() / 60
  return s.days.includes(day) && decimal >= s.openUTC && decimal < s.closeUTC
}

// ── Clock ──────────────────────────────────────────────────────────────────────

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

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

function fmtShort(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', timeZone: 'UTC',
    })
  } catch { return iso }
}

// ── Feed sync status ───────────────────────────────────────────────────────────

function useFeedSync() {
  const [lastSync, setLastSync] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('watch_events')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.updated_at) setLastSync(data.updated_at as string)
      })
  }, [])

  return lastSync
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StatusBar() {
  const now      = useClock()
  const lastSync = useFeedSync()

  const syncedToday = lastSync
    ? new Date(lastSync).toDateString() === new Date().toDateString()
    : false

  return (
    <footer className="h-6 flex-shrink-0 flex items-center justify-between px-4 bg-[#0A0E13] border-t border-terminal-border text-[10px] font-mono text-terminal-muted select-none">

      {/* Left — clock + date */}
      <div className="flex items-center gap-3">
        <span className="text-terminal-text">{fmtClock(now)}</span>
        <span className="text-terminal-border">·</span>
        <span>{fmtDate(now)}</span>
        <span className="text-terminal-border">·</span>
        <span className="tracking-widest">UTC</span>
      </div>

      {/* Centre — commodity exchange sessions */}
      <div className="flex items-center gap-4">
        {SESSIONS.map(s => {
          const open = isSessionOpen(s, now)
          return (
            <span key={s.label} title={s.title} className="flex items-center gap-1.5 cursor-default">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${open ? 'bg-emerald-400' : 'bg-terminal-border'}`} />
              <span className={open ? 'text-terminal-text' : 'text-terminal-border'}>{s.label}</span>
            </span>
          )
        })}

        <span className="text-terminal-border">·</span>

        {/* Intelligence feed sync */}
        <span className="flex items-center gap-1.5" title="Endenex intelligence feed — Airtable sync, daily 07:00 UTC">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${syncedToday ? 'bg-terminal-teal' : 'bg-terminal-border'}`} />
          <span className={syncedToday ? 'text-terminal-text' : 'text-terminal-border'}>
            Feed {syncedToday ? 'synced today' : lastSync ? `synced ${fmtShort(lastSync)}` : '· 07:00 UTC'}
          </span>
        </span>
      </div>

      {/* Right — context */}
      <div className="flex items-center gap-3">
        <span>Endenex Terminal</span>
        <span className="text-terminal-border">·</span>
        <span>Phase 1</span>
        <span className="text-terminal-border">·</span>
        <span>Onshore Wind</span>
      </div>

    </footer>
  )
}
