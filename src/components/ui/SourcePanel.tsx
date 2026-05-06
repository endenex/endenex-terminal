import type { SourceMetadata } from '@/lib/types'
import { Badge } from './Badge'

interface SourcePanelProps {
  metadata:   SourceMetadata
  className?: string
}

export function SourcePanel({ metadata, className }: SourcePanelProps) {
  const confidenceVariant =
    metadata.confidence === 'High' ? 'high' : metadata.confidence === 'Medium' ? 'medium' : 'low'
  const derivationVariant =
    metadata.derivation === 'Observed'
      ? 'observed'
      : metadata.derivation === 'Inferred'
        ? 'inferred'
        : 'modelled'

  return (
    <div
      className={`bg-canvas border border-border rounded-sm p-2.5 text-[12.5px] space-y-1.5 ${className ?? ''}`}
    >
      <div className="label-xs mb-1.5">Source &amp; Confidence</div>
      <Row label="Source type"  value={metadata.source_type} />
      <Row label="Source date"  value={metadata.source_date} />
      {metadata.signal_type && <Row label="Signal type" value={metadata.signal_type} />}
      <div className="flex items-center justify-between">
        <span className="text-ink-3">Confidence</span>
        <Badge variant={confidenceVariant}>{metadata.confidence}</Badge>
      </div>
      <Row label="Last reviewed" value={metadata.last_reviewed} />
      <div className="flex items-center justify-between">
        <span className="text-ink-3">Derivation</span>
        <Badge variant={derivationVariant}>{metadata.derivation}</Badge>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-3">{label}</span>
      <span className="text-ink tabular-nums">{value}</span>
    </div>
  )
}
