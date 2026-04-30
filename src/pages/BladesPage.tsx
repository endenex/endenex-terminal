import { Leaf } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { ModulePlaceholder } from '@/components/ui/ModulePlaceholder'

export function BladesPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Blade Waste Intelligence"
        subtitle="GRP and composite blade volumes, recycling pathways, and end-of-life cost modelling"
      />
      <ModulePlaceholder
        icon={Leaf}
        label="BLADES"
        name="Blade Waste Intelligence"
        description="Blade inventory tracking, GRP and composite material volumes by region and year, recycling pathway availability, and end-of-life cost modelling across European and US onshore wind markets. Blades handled separately from metallic scrap — no GRP volumes reported under Recovery Value."
        signals={[
          { label: 'Blade inventory by region, year, and turbine model', status: 'planned' },
          { label: 'GRP / composite material volume estimates', status: 'planned' },
          { label: 'Recycling pathway availability by geography', status: 'planned' },
          { label: 'Blade end-of-life cost modelling', status: 'planned' },
          { label: 'Processor and contractor directory', status: 'planned' },
          { label: 'Blade waste forward outlook', status: 'planned' },
        ]}
      />
    </div>
  )
}
