import { useState, useEffect } from 'react'

// ── Market sessions ────────────────────────────────────────────────────────────
// Approximate LSE / Xetra / NYSE hours in UTC (ignoring DST for now)

interface Session {
  label:    string
  openUTC:  number   // hour
  closeUTC: number   // hour
  days:     number[] // 1=Mon … 5=Fri
}

const SESSIONS: Session[] = [
  { label: 'LSE',   openUTC:  8, closeUTC: 16, days: [1,2,3,4,5] },
  { label: 'Xetra', openUTC:  8, closeUTC: 17, days: [1,2,3,4,5] },
  { label: 'NYSE',  openUTC: 14, closeUTC: 21, days: [1,2,3,4,5] },
]

function isSessionOpen(s: Session, now: Date): boolean {
  const day  = now.getUTCDay()   // 0=Sun … 6=Sat
  const hour = now.getUTCHours()
  const min  = now.getUTCMinutes()
  const decimal = hour + min / 60
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
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  })
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'UTC',
  })
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StatusBar() {
  const now = useClock()

  return (
    <footer className="h-6 flex-shrink-0 flex items-center justify-between px-4 bg-[#0A0E13] border-t border-terminal-border text-[10px] font-mono text-terminal-muted select-none">

      {/* Left — clock + date */}
      <div className="flex items-center gap-3">
        <span className="text-terminal-text">{fmtClock(now)}</span>
        <span className="text-terminal-border">·</span>
        <span>{fmtDate(now)}</span>
        <span className="text-terminal-border">·</span>
        <span className="text-terminal-muted tracking-widest">UTC</span>
      </div>

      {/* Centre — market sessions */}
      <div className="flex items-center gap-3">
        {SESSIONS.map(s => {
          const open = isSessionOpen(s, now)
          return (
            <span key={s.label} className="flex items-center gap-1">
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  open ? 'bg-emerald-400' : 'bg-terminal-border'
                }`}
              />
              <span className={open ? 'text-terminal-text' : 'text-terminal-border'}>
                {s.label}
              </span>
            </span>
          )
        })}
      </div>

      {/* Right — build / version */}
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
