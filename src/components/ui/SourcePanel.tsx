import type { SourceMetadata } from '@/lib/types'
import { Badge } from './Badge'

interface SourcePanelProps {
  metadata: SourceMetadata
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
      className={`bg-terminal-grey border border-gray-200 rounded p-3 text-xs space-y-1.5 ${className ?? ''}`}
    >
      <div className="text-gray-400 font-mono uppercase tracking-wider text-[10px] mb-2">
        Source &amp; Confidence
      </div>
      <Row label="Source type" value={metadata.source_type} />
      <Row label="Source date" value={metadata.source_date} mono />
      {metadata.signal_type && <Row label="Signal type" value={metadata.signal_type} />}
      <div className="flex items-center justify-between">
        <span className="text-gray-500">Confidence</span>
        <Badge variant={confidenceVariant}>{metadata.confidence}</Badge>
      </div>
      <Row label="Last reviewed" value={metadata.last_reviewed} mono />
      <div className="flex items-center justify-between">
        <span className="text-gray-500">Derivation</span>
        <Badge variant={derivationVariant}>{metadata.derivation}</Badge>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
