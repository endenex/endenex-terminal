import { Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Activity, SlidersHorizontal, Calculator, ArrowRight } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'

const WORKSPACES = [
  {
    path: '/market-monitor',
    icon: Activity,
    name: 'Market Monitor',
    description:
      'Structured, source-attributed intelligence on repowering events, decommissioning campaigns, and contractor activity across onshore wind markets.',
    features: [
      'Planning applications, consents, construction starts, commissioning events',
      'Decommissioning campaign activity and contractor mobilisations',
      'Country and asset class filters',
      'Source attribution and confidence level on every record',
    ],
  },
  {
    path: '/asset-screener',
    icon: SlidersHorizontal,
    name: 'Asset Screener',
    description:
      'Signal-stack classification of repowering candidates. Identify forward pipeline opportunities before public announcement.',
    features: [
      'Age, support scheme expiry, and planning signals',
      'Grid connection value and owner behaviour classification',
      'Overall classification: Watchlist / Candidate / Active / Confirmed',
      'Watchlists and saved views',
    ],
  },
  {
    path: '/workbench',
    icon: Calculator,
    name: 'Liability & Materials Workbench',
    description:
      'DCI benchmark methodology, portfolio liability estimation, and forward supply curves for recoverable materials from retiring clean energy assets.',
    features: [
      'DCI Spot — Europe (EUR/MW) and US (USD/MW)',
      'Portfolio liability estimation: gross cost, NRO, net liability ranges',
      'Board memo and lender / surety export formats',
      'Recoverable materials outlook by geography and quarter',
    ],
  },
]

export function DashboardPage() {
  const { user } = useUser()
  const greeting = user?.firstName ? `Welcome, ${user.firstName}` : 'Welcome'

  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title={greeting}
        subtitle="Market intelligence for ageing clean energy assets"
      />

      <div className="p-6 flex-1">
        {/* Build status */}
        <div className="bg-terminal-navy border border-terminal-navy-border rounded-lg px-5 py-3 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-terminal-teal" />
            <span className="text-white text-sm font-medium">
              Phase 1 — Infrastructure complete
            </span>
          </div>
          <div className="flex items-center gap-5 text-xs text-gray-500 font-mono">
            <span>DCI Europe · DCI US</span>
            <span>Onshore Wind</span>
            <span>DE · GB · US</span>
          </div>
        </div>

        {/* Workspace tiles */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
          {WORKSPACES.map(({ path, icon: Icon, name, description, features }) => (
            <Link key={path} to={path} className="group block">
              <Card className="h-full transition-shadow hover:shadow-md hover:border-gray-300">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-9 h-9 bg-terminal-teal/10 rounded-lg flex items-center justify-center">
                      <Icon size={17} className="text-terminal-teal" />
                    </div>
                    <Badge variant="phase1">Phase 1</Badge>
                  </div>

                  <h3 className="text-gray-900 font-semibold text-sm mb-2">{name}</h3>
                  <p className="text-gray-500 text-xs leading-relaxed mb-4">{description}</p>

                  <ul className="space-y-1.5 mb-5">
                    {features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
                        <div className="w-1 h-1 rounded-full bg-terminal-teal flex-shrink-0 mt-1.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <span className="text-xs text-gray-400 font-mono">In development</span>
                    <ArrowRight
                      size={13}
                      className="text-gray-300 group-hover:text-terminal-teal transition-colors"
                    />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-2 gap-4">
          <Card>
            <div className="p-5">
              <div className="text-[10px] text-gray-400 font-mono tracking-widest uppercase mb-4">
                Asset Registry Coverage — Phase 1
              </div>
              <div className="space-y-2.5">
                {[
                  { market: 'Germany', source: 'MaStR', note: 'Ingestion pipeline — Step 2' },
                  { market: 'United Kingdom', source: 'REPD', note: 'Ingestion pipeline — Step 2' },
                  { market: 'United States', source: 'USWTDB', note: 'Ingestion pipeline — Step 2' },
                ].map(({ market, source, note }) => (
                  <div key={market} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-900 font-medium">{market}</span>
                      <span className="text-gray-400 font-mono">{source}</span>
                    </div>
                    <span className="text-gray-400">{note}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-5">
              <div className="text-[10px] text-gray-400 font-mono tracking-widest uppercase mb-4">
                DCI Publication Status
              </div>
              <div className="space-y-2.5">
                {[
                  { index: 'DCI Europe · Spot', ccy: 'EUR / MW', status: 'Pending methodology' },
                  { index: 'DCI US · Spot', ccy: 'USD / MW', status: 'Pending methodology' },
                  { index: 'DCI Forward', ccy: '—', status: 'Phase 2' },
                  { index: 'DCI Reserve', ccy: '—', status: 'Phase 2' },
                ].map(({ index, ccy, status }) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-900 font-medium font-mono">{index}</span>
                      <span className="text-gray-400">{ccy}</span>
                    </div>
                    <span className="text-gray-400">{status}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
