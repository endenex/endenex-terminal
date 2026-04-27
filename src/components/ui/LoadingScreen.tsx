export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-terminal-navy flex items-center justify-center">
      <div className="text-center">
        <div className="text-terminal-teal font-mono text-xs tracking-widest mb-3">
          ENDENEX TERMINAL
        </div>
        <div className="w-48 h-px bg-terminal-navy-border overflow-hidden mx-auto">
          <div className="h-full w-1/3 bg-terminal-teal animate-pulse" />
        </div>
      </div>
    </div>
  )
}
