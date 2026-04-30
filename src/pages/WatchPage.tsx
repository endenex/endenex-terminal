import { Radio } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { ModulePlaceholder } from '@/components/ui/ModulePlaceholder'

export function WatchPage() {
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <TopBar
        title="Market Watch"
        subtitle="Repowering events, decommissioning campaigns, and contractor activity"
      />
      <ModulePlaceholder
        icon={Radio}
        label="WATCH"
        name="Market Watch"
        description="Structured, source-attributed intelligence on repowering announcements, planning applications, consents, construction starts, decommissioning campaign activity, and contractor mobilisations across onshore wind markets. Source type, signal confidence, and last reviewed date on every record."
        signals={[
          { label: 'Repowering announcements and planning applications', status: 'planned' },
          { label: 'Decommissioning campaign activity', status: 'planned' },
          { label: 'Contractor mobilisation signals', status: 'planned' },
          { label: 'Country, event type, and confidence filters', status: 'planned' },
          { label: 'Source attribution on every record', status: 'planned' },
          { label: 'Weekly update cadence', status: 'planned' },
        ]}
      />
    </div>
  )
}
