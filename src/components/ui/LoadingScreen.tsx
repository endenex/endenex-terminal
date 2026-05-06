export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <div className="text-center">
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase mb-2 text-teal">
          ENDENEX TERMINAL
        </div>
        <div className="w-44 h-px bg-border overflow-hidden mx-auto">
          <div className="h-full w-1/3 bg-teal animate-pulse" />
        </div>
      </div>
    </div>
  )
}
