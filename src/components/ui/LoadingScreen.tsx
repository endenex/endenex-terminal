export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-chrome-bg flex items-center justify-center">
      <div className="text-center">
        <div
          className="text-[11px] font-bold tracking-[0.12em] uppercase mb-3"
          style={{ color: '#14A4B4' }}
        >
          ENDENEX TERMINAL
        </div>
        <div className="w-48 h-px bg-chrome-border overflow-hidden mx-auto">
          <div className="h-full w-1/3 bg-teal animate-pulse" />
        </div>
      </div>
    </div>
  )
}
