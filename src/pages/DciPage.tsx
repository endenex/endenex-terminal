import { TopBar } from '@/components/layout/TopBar'
import { ModulePlaceholder } from '@/components/ui/ModulePlaceholder'

export function DciPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Decommissioning Cost Index"
        subtitle="Independent benchmark for wind turbine decommissioning costs"
      />
      <ModulePlaceholder
        label="DCI"
        name="Decommissioning Cost Index"
        description="An independent, methodology-driven benchmark for onshore wind turbine decommissioning costs. Spot values published as confidence ranges — never single-point estimates. Full methodology documentation version-controlled, exportable, and citable."
        signals={[
          { label: 'DCI Spot — Europe (EUR / MW)', status: 'building' },
          { label: 'DCI Spot — United States (USD / MW)', status: 'building' },
          { label: 'Confidence ranges and methodology documentation', status: 'building' },
          { label: 'Portfolio liability workbench', status: 'building' },
          { label: 'Sensitivity analysis — commodity price and timing scenarios', status: 'planned' },
          { label: 'Board memo, surety, and lender export formats', status: 'planned' },
          { label: 'DCI Forward curve', status: 'planned' },
          { label: 'DCI Reserve index', status: 'planned' },
        ]}
      />
    </div>
  )
}
