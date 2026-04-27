import { SlidersHorizontal } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { WorkspaceInDevelopment } from '@/components/ui/WorkspaceInDevelopment'

export function AssetScreenerPage() {
  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title="Asset Screener"
        subtitle="Signal-stack repowering intelligence across onshore wind"
      />
      <div className="p-6">
        <WorkspaceInDevelopment
          icon={SlidersHorizontal}
          name="Asset Screener"
          phase="Phase 1"
          description="Signal-stack classification of repowering candidates across Germany, UK, and US onshore wind. Identifies forward pipeline opportunities before public announcement using age, support scheme expiry, planning activity, grid connection value, owner behaviour, and physical constraint signals."
          features={[
            'Signal-stack classification per site: age, support expiry, planning, grid value, owner behaviour, physical constraint',
            'Overall classification: Watchlist / Candidate / Active / Confirmed',
            'Owner and operator identification where derivable from public registries',
            'Filterable by country, vintage, capacity, owner, and overall classification',
            'Watchlist functionality — saved views as first-class features',
            'Source attribution and confidence level on every signal',
          ]}
        />
      </div>
    </div>
  )
}
