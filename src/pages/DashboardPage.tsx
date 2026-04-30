import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { TrendingUp, Wind, Layers, Leaf, Radio, BarChart2, ArrowRight } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'

const MODULES = [
  {
    path: '/dci',
    icon: TrendingUp,
    label: 'DCI',
    name: 'Decommissioning Cost Index',
    description: 'Independent benchmark for wind turbine decommissioning costs. Spot values, confidence ranges, and full methodology documentation.',
    status: 'In build',
    statusClass: 'text-terminal-teal',
  },
  {
    path: '/retirement',
    icon: Wind,
    label: 'RETIREMENT',
    name: 'Asset Retirement Intelligence',
    description: 'Repowering pipeline screener. Projects by stage, country, capacity, turbine specification, and developer — with source attribution on every record.',
    status: 'Live',
    statusClass: 'text-emerald-400',
  },
  {
    path: '/materials',
    icon: Layers,
    label: 'MATERIALS',
    name: 'Recovery Value',
    description: 'Scrap metal prices and net recovery offsets by material type and region. Steel, copper, aluminium, and rare earth — updated from published market indices.',
    status: 'Live',
    statusClass: 'text-emerald-400',
  },
  {
    path: '/blades',
    icon: Leaf,
    label: 'BLADES',
    name: 'Blade Waste Intelligence',
    description: 'GRP and composite blade volumes by region and year. Recycling pathway availability, end-of-life cost modelling, and contractor directory.',
    status: 'Planned',
    statusClass: 'text-terminal-muted',
  },
  {
    path: '/watch',
    icon: Radio,
    label: 'WATCH',
    name: 'Market Watch',
    description: 'Structured, source-attributed intelligence on repowering events, decommissioning campaigns, and contractor activity across onshore wind markets.',
    status: 'Planned',
    statusClass: 'text-terminal-muted',
  },
  {
    path: '/portfolio',
    icon: BarChart2,
    label: 'PORTFOLIO',
    name: 'Portfolio Analytics',
    description: 'Portfolio liability exposure modelling, NRO attribution by site, sensitivity analysis, and export formats for boards, lenders, and sureties.',
    status: 'Planned',
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
        <div className="flex items-center justify-between bg-terminal-surface border border-terminal-border rounded-lg px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-terminal-teal animate-pulse" />
            <span className="text-terminal-text text-xs font-medium font-mono">
              ENDENEX TERMINAL · PHASE 1
            </span>
          </div>
          <div className="flex items-center gap-5 text-[11px] text-terminal-muted font-mono">
            <span>DE · GB · US · DK · FR · ES</span>
            <span>Onshore Wind</span>
          </div>
        </div>

        {/* Module grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map(({ path, icon: Icon, label, name, description, status, statusClass }) => (
            <Link key={path} to={path} className="group block">
              <div className="h-full border border-terminal-border rounded-lg bg-terminal-surface hover:border-terminal-teal/40 transition-colors p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-terminal-black border border-terminal-border rounded flex items-center justify-center">
                      <Icon size={14} className="text-terminal-teal" />
                    </div>
                    <div>
                      <div className="text-[10px] font-mono text-terminal-muted tracking-widest">{label}</div>
                      <div className="text-xs font-semibold text-terminal-text leading-tight">{name}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-mono ${statusClass}`}>{status}</span>
                </div>

                <p className="text-xs text-terminal-muted leading-relaxed mb-4">{description}</p>

                <div className="flex items-center justify-between pt-3 border-t border-terminal-border">
                  <span className="text-[10px] font-mono text-terminal-muted">Open module</span>
                  <ArrowRight
                    size={12}
                    className="text-terminal-muted group-hover:text-terminal-teal transition-colors"
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Data coverage */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-terminal-border rounded-lg bg-terminal-surface p-5">
            <div className="text-[10px] text-terminal-muted font-mono tracking-widest uppercase mb-4">
              Asset Registry Coverage
            </div>
            <div className="space-y-2.5">
              {[
                { market: 'Germany',        source: 'MaStR',         turbines: '~30,000' },
                { market: 'United Kingdom', source: 'REPD',          turbines: '~15,000' },
                { market: 'United States',  source: 'USWTDB',        turbines: '~72,000' },
                { market: 'Denmark',        source: 'Energistyrelsen', turbines: '~6,000' },
                { market: 'France',         source: 'ODRÉ',          turbines: '~8,000'  },
                { market: 'Spain',          source: 'GEM Tracker',   turbines: '~23,000' },
              ].map(({ market, source, turbines }) => (
                <div key={market} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-terminal-text font-medium">{market}</span>
                    <span className="text-terminal-muted font-mono text-[11px]">{source}</span>
                  </div>
                  <span className="text-terminal-muted font-mono text-[11px]">{turbines}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-terminal-border rounded-lg bg-terminal-surface p-5">
            <div className="text-[10px] text-terminal-muted font-mono tracking-widest uppercase mb-4">
              DCI Publication Status
            </div>
            <div className="space-y-2.5">
              {[
                { index: 'DCI Europe · Spot', ccy: 'EUR / MW', status: 'Methodology in build' },
                { index: 'DCI US · Spot',     ccy: 'USD / MW', status: 'Methodology in build' },
                { index: 'DCI Forward',        ccy: '—',        status: 'Phase 2' },
                { index: 'DCI Reserve',        ccy: '—',        status: 'Phase 2' },
              ].map(({ index, ccy, status }) => (
                <div key={index} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-terminal-text font-medium font-mono">{index}</span>
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
