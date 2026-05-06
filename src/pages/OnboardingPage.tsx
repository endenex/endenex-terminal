import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Check } from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '@/lib/supabase'
import type { UserCohort, AssetClass } from '@/lib/types'
import {
  COHORT_LABELS,
  COHORT_DESCRIPTIONS,
  ASSET_CLASS_LABELS,
  ASSET_CLASS_PHASE,
  GEOGRAPHIC_OPTIONS,
} from '@/lib/constants'
import { Button } from '@/components/ui/Button'

type Step = 1 | 2 | 3

export function OnboardingPage() {
  const { user } = useUser()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [cohort, setCohort] = useState<UserCohort | null>(null)
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([])
  const [geographicFocus, setGeographicFocus] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const toggleAssetClass = (ac: AssetClass) =>
    setAssetClasses((prev) => prev.includes(ac) ? prev.filter((x) => x !== ac) : [...prev, ac])

  const toggleGeo = (code: string) =>
    setGeographicFocus((prev) => prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code])

  const handleComplete = async () => {
    if (!user || !cohort) return
    setSaving(true)
    try {
      await supabase.from('user_profiles').upsert(
        {
          clerk_user_id: user.id,
          cohort,
          asset_class_interest: assetClasses,
          geographic_focus: geographicFocus,
          onboarding_completed: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'clerk_user_id' }
      )
      navigate('/dashboard')
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-page">
      <div className="bg-chrome-bg border-b border-chrome-border px-4 h-10 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-teal-bright font-bold text-[11px] tracking-[0.18em]">ENDENEX·TERMINAL</span>
          <span className="text-chrome-muted text-[10px] tracking-widest uppercase ml-2">Onboarding</span>
        </div>
        <div className="flex items-center gap-1">
          {([1, 2, 3] as const).map((s) => (
            <div key={s} className={clsx('h-0.5 rounded-sm transition-all duration-300', {
              'w-8 bg-teal-bright':       s === step,
              'w-4 bg-teal-bright/40':    s < step,
              'w-4 bg-chrome-border':     s > step,
            })} />
          ))}
        </div>
      </div>

      <div className="max-w-xl mx-auto px-6 py-10">
        {step === 1 && <StepCohort selected={cohort} onSelect={setCohort} onNext={() => setStep(2)} />}
        {step === 2 && <StepAssetClass selected={assetClasses} onToggle={toggleAssetClass} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <StepGeography selected={geographicFocus} onToggle={toggleGeo} onBack={() => setStep(2)} onComplete={handleComplete} saving={saving} />}
      </div>
    </div>
  )
}

function StepLabel({ step }: { step: number }) {
  return <div className="label-xs mb-2">STEP {step} OF 3</div>
}

function SelectionCard({ selected, onClick, children }: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative text-left p-3 rounded-sm border transition-colors w-full',
        selected
          ? 'bg-teal-dim border-teal text-ink'
          : 'bg-panel border-border text-ink-2 hover:border-teal/40 hover:text-ink'
      )}
    >
      {selected && (
        <div className="absolute top-2 right-2 w-3.5 h-3.5 bg-teal rounded-sm flex items-center justify-center">
          <Check size={9} className="text-white" />
        </div>
      )}
      {children}
    </button>
  )
}

function StepCohort({ selected, onSelect, onNext }: {
  selected: UserCohort | null
  onSelect: (c: UserCohort) => void
  onNext: () => void
}) {
  const cohorts = Object.entries(COHORT_LABELS) as [UserCohort, string][]
  return (
    <div>
      <StepLabel step={1} />
      <h1 className="text-ink text-[20px] font-semibold mb-1">How do you use this market?</h1>
      <p className="text-ink-3 text-[12.5px] mb-6">
        Sets your default workspace. You have full access to all modules regardless of selection.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-6">
        {cohorts.map(([key, label]) => (
          <SelectionCard key={key} selected={selected === key} onClick={() => onSelect(key)}>
            <div className="text-[13px] font-semibold mb-0.5 pr-5">{label}</div>
            <div className="text-[11.5px] text-ink-3">{COHORT_DESCRIPTIONS[key]}</div>
          </SelectionCard>
        ))}
      </div>
      <Button onClick={onNext} disabled={!selected} size="lg">Continue</Button>
    </div>
  )
}

function StepAssetClass({ selected, onToggle, onBack, onNext }: {
  selected: AssetClass[]
  onToggle: (ac: AssetClass) => void
  onBack: () => void
  onNext: () => void
}) {
  const classes = Object.entries(ASSET_CLASS_LABELS) as [AssetClass, string][]
  return (
    <div>
      <StepLabel step={2} />
      <h1 className="text-ink text-[20px] font-semibold mb-1">Which asset classes are relevant?</h1>
      <p className="text-ink-3 text-[12.5px] mb-6">Select all that apply.</p>
      <div className="grid grid-cols-2 gap-2 mb-6">
        {classes.map(([key, label]) => (
          <SelectionCard key={key} selected={selected.includes(key)} onClick={() => onToggle(key)}>
            <div className="text-[13px] font-semibold mb-0.5 pr-5">{label}</div>
            <div className="text-[10.5px] uppercase tracking-wide text-ink-3">Phase {ASSET_CLASS_PHASE[key]}</div>
          </SelectionCard>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack} size="lg">Back</Button>
        <Button onClick={onNext} size="lg">Continue</Button>
      </div>
    </div>
  )
}

function StepGeography({ selected, onToggle, onBack, onComplete, saving }: {
  selected: string[]
  onToggle: (code: string) => void
  onBack: () => void
  onComplete: () => void
  saving: boolean
}) {
  return (
    <div>
      <StepLabel step={3} />
      <h1 className="text-ink text-[20px] font-semibold mb-1">Geographic focus</h1>
      <p className="text-ink-3 text-[12.5px] mb-6">
        Optional. Terminal covers all markets equally.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-6">
        {GEOGRAPHIC_OPTIONS.map(({ code, label, phase }) => (
          <SelectionCard key={code} selected={selected.includes(code)} onClick={() => onToggle(code)}>
            <div className="text-[13px] font-semibold pr-5">{label}</div>
            {phase > 1 && (
              <div className="text-[10.5px] uppercase tracking-wide text-ink-4 mt-0.5">Phase {phase}</div>
            )}
          </SelectionCard>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack} size="lg">Back</Button>
        <Button onClick={onComplete} disabled={saving} size="lg">
          {saving ? 'Saving…' : 'Enter Terminal'}
        </Button>
      </div>
    </div>
  )
}
