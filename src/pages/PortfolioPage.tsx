import { TopBar } from '@/components/layout/TopBar'
import { ModulePlaceholder } from '@/components/ui/ModulePlaceholder'

export function PortfolioPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Portfolio Analytics"
        subtitle="Liability exposure modelling and NRO attribution across your asset portfolio"
      />
      <ModulePlaceholder
        label="PORTFOLIO"
        name="Portfolio Analytics"
        description="Upload and configure your portfolio of wind assets. Model aggregate decommissioning liability exposure against DCI benchmarks, attribute Net Recovery Offset by site, run sensitivity scenarios, and export in formats suited to boards, lenders, and sureties."
        signals={[
          { label: 'Portfolio upload and site configuration', status: 'planned' },
          { label: 'Aggregate liability exposure vs DCI benchmark', status: 'planned' },
          { label: 'NRO attribution by site and material type', status: 'planned' },
          { label: 'Sensitivity analysis — price and timing scenarios', status: 'planned' },
          { label: 'Board memo export', status: 'planned' },
          { label: 'Surety and lender pack export', status: 'planned' },
          { label: 'Alert thresholds and watchlists', status: 'planned' },
        ]}
      />
    </div>
  )
}
