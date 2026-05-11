// ── DCI Publication Schedule Overlay ─────────────────────────────────────────
// Triggered from BottomFooter "DCI Publication" button.
// Surfaces publication cadence, methodology version, rebalance dates,
// and IOSCO compliance — moved here from a dedicated DCI-page panel
// because it's static reference info, not a workspace.

import { DCI_PUBLICATION } from '@/data/dci_meta'

interface Props {
  onClose: () => void
}

export function DciPublicationOverlay({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-border rounded-sm shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="h-9 px-3 flex items-center justify-between border-b border-border bg-titlebar sticky top-0 z-10">
          <div className="flex items-baseline gap-2">
            <span className="text-[11.5px] font-bold text-[#0A1628] uppercase tracking-wider">DCI</span>
            <span className="text-[10px] text-ink-4">·</span>
            <span className="text-[12.5px] font-semibold text-ink">Publication Schedule</span>
          </div>
          <button
            onClick={onClose}
            className="text-ink-3 hover:text-ink text-[16px] leading-none"
            title="Close"
          >×</button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 text-[11.5px]">
          <Row label="Next publication"   value={DCI_PUBLICATION.next_publication} />
          <Row label="Last publication"   value={DCI_PUBLICATION.last_publication} />
          <Row label="Cadence"            value={DCI_PUBLICATION.cadence} />
          <Row label="Methodology"        value={`${DCI_PUBLICATION.methodology_version} · effective ${DCI_PUBLICATION.methodology_effective}`} />
          <Row label="Annual rebalance"   value={DCI_PUBLICATION.rebalance_date} />
          <Row label="Compliance"         value={DCI_PUBLICATION.iosco_compliant ? 'IOSCO PRA principles' : '—'} />

          <div className="pt-3 mt-3 border-t border-border text-[10.5px] text-ink-3 leading-snug">
            Quarterly headline publication. Underlying input prices for high-frequency
            variables (freight benchmarks, metal exchange data) refresh monthly during the
            quarter; the headline number itself republishes only on the quarterly schedule.
            Annual rebalance applies new sub-archetype capacity weights based on
            prior-year decommissioned MW share.
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-bold text-ink-4 uppercase tracking-wider">{label}</div>
      <div className="text-ink mt-0.5">{value}</div>
    </div>
  )
}
