import { useUser } from '@clerk/clerk-react'
import { TopBar } from '@/components/layout/TopBar'

const MODULES = [
  {
    id:          'dci',
    label:       'DCI',
    name:        'Decommissioning Cost Index',
    description: 'Independent benchmark for wind turbine decommissioning costs. Spot values, confidence ranges, and full methodology documentation.',
    status:      'In build',
    statusClass: 'text-terminal-teal',
  },
  {
    id:          'retirement',
    label:       'RETIREMENT',
    name:        'Asset Retirement Intelligence',
    description: 'Repowering pipeline screener by stage, country, capacity, turbine specification, and developer — with source attribution on every record.',
    status:      'Live',
    statusClass: 'text-emerald-400',
  },
  {
    id:          'materials',
    label:       'MATERIALS',
    name:        'Recovery Value',
    description: 'Scrap metal prices and net recovery offsets by material type and region. Steel, copper, aluminium, and rare earth — updated from published market indices.',
    status:      'Live',
    statusClass: 'text-emerald-400',
  },
  {
    id:          'blades',
    label:       'BLADES',
    name:        'Blade Waste Intelligence',
    description: 'GRP and composite blade volumes by region and year. Recycling pathway availability, end-of-life cost modelling, and contractor directory.',
    status:      'Planned',
    statusClass: 'text-terminal-muted',
  },
  {
    id:          'watch',
    label:       'WATCH',
    name:        'Market Watch',
    description: 'Intelligence feed: repowering events, regulatory changes, commodity signals, and supply chain activity across onshore wind markets.',
    status:      'Live',
    statusClass: 'text-emerald-400',
  },
  {
    id:          'portfolio',
    label:       'PORTFOLIO',
    name:        'Portfolio Analytics',
    description: 'Portfolio liability exposure modelling, NRO attribution by site, sensitivity analysis, and export formats for boards, lenders, and sureties.',
    status:      'Planned',
    statusClass: 'text-terminal-muted',
  },
]

export function DashboardPage() {
  const { user } = useUser()
  const firstName = user?.firstName ?? ''

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title={firstName ? `Welcome, ${firstName}` : 'Welcome'}
        subtitle="Institutional intelligence for ageing clean energy assets"
      />

      <div className="p-6 space-y-6">

        {/* Status banner */}
        <div className="flex items-center justify-between bg-terminal-surface border border-terminal-border rounded px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-terminal-teal animate-pulse" />
            <span className="text-terminal-text text-xs font-medium">
              Endenex Terminal · Phase 1
            </span>
          </div>
          <div className="flex items-center gap-5 text-[11px] text-terminal-muted">
            <span>DE · GB · US · DK · FR · ES</span>
            <span>Onshore Wind</span>
          </div>
        </div>

        {/* Module grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-terminal-border rounded overflow-hidden">
          {MODULES.map(({ label, name, description, status, statusClass }) => (
            <div key={label} className="bg-terminal-surface p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-[10px] text-terminal-muted tracking-widest uppercase mb-0.5">{label}</div>
                  <div className="text-sm font-semibold text-terminal-text">{name}</div>
                </div>
                <span className={`text-[10px] ${statusClass} flex-shrink-0 mt-0.5`}>{status}</span>
              </div>
              <p className="text-xs text-terminal-muted leading-relaxed">{description}</p>
            </div>
          ))}
        </div>

        {/* Data coverage */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-terminal-border rounded bg-terminal-surface p-5">
            <div className="text-[10px] text-terminal-muted tracking-widest uppercase mb-4">
              Asset Registry Coverage
            </div>
            <div className="space-y-2.5">
              {[
                { market: 'Germany',        source: 'MaStR',            turbines: '~30,000' },
                { market: 'United Kingdom', source: 'REPD',             turbines: '~15,000' },
                { market: 'United States',  source: 'USWTDB',           turbines: '~72,000' },
                { market: 'Denmark',        source: 'Energistyrelsen',  turbines: '~6,000'  },
                { market: 'France',         source: 'ODRÉ',             turbines: '~8,000'  },
                { market: 'Spain',          source: 'GEM Tracker',      turbines: '~23,000' },
              ].map(({ market, source, turbines }) => (
                <div key={market} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-terminal-text">{market}</span>
                    <span className="text-terminal-muted font-mono text-[11px]">{source}</span>
                  </div>
                  <span className="text-terminal-muted font-mono text-[11px]">{turbines}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-terminal-border rounded bg-terminal-surface p-5">
            <div className="text-[10px] text-terminal-muted tracking-widest uppercase mb-4">
              DCI Publication Status
            </div>
            <div className="space-y-2.5">
              {[
                { index: 'DCI Europe · Spot', ccy: 'EUR / MW', status: 'Methodology in build' },
                { index: 'DCI US · Spot',     ccy: 'USD / MW', status: 'Methodology in build' },
                { index: 'DCI Forward',       ccy: '—',        status: 'Phase 2' },
                { index: 'DCI Reserve',       ccy: '—',        status: 'Phase 2' },
              ].map(({ index, ccy, status }) => (
                <div key={index} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-terminal-text font-mono">{index}</span>
                    <span className="text-terminal-muted text-[11px]">{ccy}</span>
                  </div>
                  <span className="text-terminal-muted text-[11px]">{status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
