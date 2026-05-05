// ── Bottom utility footer ───────────────────────────────────────────────────
// Thin strip at the bottom of every screen.
// Spec: Product Brief v1.0 §5.4
// Contents (right-aligned): Alerts · Methodology · Coverage · Account · Logout

import { useClerk } from '@clerk/clerk-react'

export function BottomFooter() {
  const { signOut } = useClerk()

  return (
    <footer className="flex-shrink-0 h-7 bg-canvas border-t border-border flex items-center justify-between px-5 select-none">

      {/* Left — methodology version */}
      <span className="text-[10px] text-ink-4">
        Methodology <span className="font-medium text-ink-3">v1.0</span>
      </span>

      {/* Right — utility actions */}
      <div className="flex items-center gap-5">
        <button className="text-[10px] text-ink-3 hover:text-ink transition-colors flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-highlight inline-block" />
          Alerts
        </button>
        <button className="text-[10px] text-ink-3 hover:text-ink transition-colors">
          Methodology v1.0
        </button>
        <button className="text-[10px] text-ink-3 hover:text-ink transition-colors">
          Coverage
        </button>
        <button className="text-[10px] text-ink-3 hover:text-ink transition-colors">
          Account
        </button>
        <span className="w-px h-3 bg-border" />
        <button
          onClick={() => signOut()}
          className="text-[10px] text-ink-3 hover:text-ink transition-colors"
        >
          Logout
        </button>
      </div>

    </footer>
  )
}
