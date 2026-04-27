import { Activity } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { WorkspaceInDevelopment } from '@/components/ui/WorkspaceInDevelopment'

export function MarketMonitorPage() {
  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title="Market Monitor"
        subtitle="Live repowering tracker and decommissioning campaign activity"
      />
      <div className="p-6">
        <WorkspaceInDevelopment
          icon={Activity}
          name="Market Monitor"
          phase="Phase 1"
          description="Structured, source-attributed intelligence on repowering activity, decommissioning campaigns, contractor mobilisations, and processor utilisation signals across onshore wind markets in Germany, United Kingdom, and United States."
          features={[
            'Announced repowerings, planning applications, consents, construction starts, commissioning events',
            'Decommissioning campaign activity and contractor mobilisations',
            'Country filter, asset class filter, event type filter — no default country applied',
            'Source type, source date, signal type, confidence, and last reviewed date on every record',
            'Weekly update cadence via manual curation — automated ingestion pipeline in Phase 2',
            'Saved views',
          ]}
        />
      </div>
    </div>
  )
}
