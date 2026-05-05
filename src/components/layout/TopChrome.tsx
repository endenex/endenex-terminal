// ── Top chrome ─────────────────────────────────────────────────────────────
// Dark navy strip — brand wordmark + five DCI index ticker.
// Spec: Product Brief v1.0 §5.1

const TICKER_ITEMS = [
  { label: 'DCI WIND EU',    value: '—',  unit: '/MW', delta: null, ccy: '€' },
  { label: 'DCI WIND NA',    value: '—',  unit: '/MW', delta: null, ccy: '$' },
  { label: 'DCI SOLAR EU',   value: '—',  unit: '/MW', delta: null, ccy: '€' },
  { label: 'DCI SOLAR NA',   value: '—',  unit: '/MW', delta: null, ccy: '$' },
  { label: 'DCI SOLAR JP',   value: '—',  unit: '/MW', delta: null, ccy: '¥' },
]

export function TopChrome() {
  return (
    <div className="flex-shrink-0 h-10 bg-chrome-bg border-b border-chrome-border flex items-center px-5 gap-5 select-none">

      {/* Wordmark */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <img src="/logo-white.png" alt="Endenex" className="h-3.5 w-auto" />
        <span
          className="text-[11px] font-bold tracking-[0.12em] uppercase"
          style={{ color: '#14A4B4' }}
        >
          TERMINAL
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-chrome-border flex-shrink-0" />

      {/* Five-index ticker */}
      <div className="flex items-center gap-6 overflow-x-auto min-w-0">
        {TICKER_ITEMS.map((item, i) => (
          <div key={i} className="flex items-baseline gap-1.5 flex-shrink-0">
            <span className="text-[10px] font-semibold tracking-wider text-chrome-muted">
              {item.label}
            </span>
            <span className="text-[12px] font-semibold text-chrome-text">
              {item.value !== '—' ? `${item.ccy}${item.value}` : '—'}
            </span>
            {item.value !== '—' && (
              <span className="text-[10px] text-chrome-muted">{item.unit}</span>
            )}
            {item.delta && (
              <span className={`text-[10px] font-semibold ${item.delta > 0 ? 'text-up' : 'text-down'}`}>
                {item.delta > 0 ? '▲' : '▼'} {Math.abs(item.delta).toFixed(1)}% m/m
              </span>
            )}
          </div>
        ))}
      </div>

    </div>
  )
}
