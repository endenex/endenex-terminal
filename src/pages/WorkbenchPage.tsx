import { Calculator } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { WorkspaceInDevelopment } from '@/components/ui/WorkspaceInDevelopment'

export function WorkbenchPage() {
  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title="Liability & Materials Workbench"
        subtitle="DCI benchmark, portfolio liability estimation, and recoverable materials outlook"
      />
      <div className="p-6">
        <WorkspaceInDevelopment
          icon={Calculator}
          name="Liability & Materials Workbench"
          phase="Phase 1"
          description="DCI benchmark methodology and spot values, portfolio liability estimation against independent market reference data, and forward supply curves for recoverable materials from retiring onshore wind assets across European and US markets."
          features={[
            'DCI Spot — Europe (EUR/MW) and US (USD/MW), with confidence ranges — never single point estimates',
            'Full methodology documentation: version-controlled, exportable, citable',
            'Portfolio liability workbench: gross cost, NRO (Net Recovery Offset), and net liability ranges',
            'Sensitivity analysis: commodity price and timing scenarios',
            'Three export formats: quick range, board memo PDF, surety and lender export',
            'Recoverable materials outlook by material type, geography, and quarter',
            'DCI Forward and DCI Reserve: methodology roadmap — Phase 2',
          ]}
        />
      </div>
    </div>
  )
}
