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
    setAssetClasses((prev) =>
      prev.includes(ac) ? prev.filter((x) => x !== ac) : [...prev, ac]
    )

  const toggleGeo = (code: string) =>
    setGeographicFocus((prev) =>
      prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]
    )

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
    <div className="min-h-screen bg-terminal-navy">
      {/* Header */}
      <div className="border-b border-terminal-navy-border px-8 py-4 flex items-center justify-between">
        <div>
          <span className="text-terminal-teal font-mono text-[11px] tracking-[0.2em]">ENDENEX</span>
          <span className="text-gray-500 font-mono text-[11px] tracking-[0.2em] ml-2">TERMINAL</span>
        </div>
        <div className="flex items-center gap-1.5">
          {([1, 2, 3] as const).map((s) => (
            <div
              key={s}
              className={clsx('h-1 rounded-full transition-all duration-300', {
                'w-8 bg-terminal-teal': s === step,
                'w-4 bg-terminal-teal/40': s < step,
                'w-4 bg-terminal-navy-border': s > step,
              })}
            />
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-8 py-12">
        {step === 1 && (
          <StepCohort selected={cohort} onSelect={setCohort} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <StepAssetClass
            selected={assetClasses}
            onToggle={toggleAssetClass}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepGeography
            selected={geographicFocus}
            onToggle={toggleGeo}
            onBack={() => setStep(2)}
            onComplete={handleComplete}
            saving={saving}
          />
        )}
      </div>
    </div>
  )
}

function StepLabel({ step }: { step: number }) {
  return (
    <div className="text-gray-500 text-[11px] font-mono tracking-widest mb-2">
      STEP {step} OF 3
    </div>
  )
}

function SelectionCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative text-left p-4 rounded border transition-colors w-full',
        selected
          ? 'bg-terminal-teal/10 border-terminal-teal text-white'
          : 'bg-terminal-navy-light border-terminal-navy-border text-gray-300 hover:border-terminal-teal/40 hover:text-white'
      )}
    >
      {selected && (
        <div className="absolute top-3 right-3 w-4 h-4 bg-terminal-teal rounded-full flex items-center justify-center">
          <Check size={10} className="text-white" />
        </div>
      )}
      {children}
    </button>
  )
}

function StepCohort({
  selected,
  onSelect,
  onNext,
}: {
  selected: UserCohort | null
  onSelect: (c: UserCohort) => void
  onNext: () => void
}) {
  const cohorts = Object.entries(COHORT_LABELS) as [UserCohort, string][]

  return (
    <div>
      <StepLabel step={1} />
      <h1 className="text-white text-2xl font-semibold mb-2">How do you use this market?</h1>
      <p className="text-gray-400 text-sm mb-8">
        This sets your default workspace. You have full access to all modules regardless of
        selection.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-8">
        {cohorts.map(([key, label]) => (
          <SelectionCard key={key} selected={selected === key} onClick={() => onSelect(key)}>
            <div className="text-sm font-medium mb-1 pr-6">{label}</div>
            <div className="text-xs text-gray-500">{COHORT_DESCRIPTIONS[key]}</div>
          </SelectionCard>
        ))}
      </div>

      <Button onClick={onNext} disabled={!selected} size="lg">
        Continue
      </Button>
    </div>
  )
}

function StepAssetClass({
  selected,
  onToggle,
  onBack,
  onNext,
}: {
  selected: AssetClass[]
  onToggle: (ac: AssetClass) => void
  onBack: () => void
  onNext: () => void
}) {
  const classes = Object.entries(ASSET_CLASS_LABELS) as [AssetClass, string][]

  return (
    <div>
      <StepLabel step={2} />
      <h1 className="text-white text-2xl font-semibold mb-2">Which asset classes are relevant?</h1>
      <p className="text-gray-400 text-sm mb-8">Select all that apply. You can update this at any time.</p>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {classes.map(([key, label]) => (
          <SelectionCard key={key} selected={selected.includes(key)} onClick={() => onToggle(key)}>
            <div className="text-sm font-medium mb-1 pr-6">{label}</div>
            <div className="text-xs font-mono text-gray-500">Phase {ASSET_CLASS_PHASE[key]}</div>
          </SelectionCard>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onBack} size="lg">Back</Button>
        <Button onClick={onNext} size="lg">Continue</Button>
      </div>
    </div>
  )
}

function StepGeography({
  selected,
  onToggle,
  onBack,
  onComplete,
  saving,
}: {
  selected: string[]
  onToggle: (code: string) => void
  onBack: () => void
  onComplete: () => void
  saving: boolean
}) {
  return (
    <div>
      <StepLabel step={3} />
      <h1 className="text-white text-2xl font-semibold mb-2">Geographic focus</h1>
      <p className="text-gray-400 text-sm mb-8">
        Optional. Terminal covers all markets equally — this sets your default view only. No
        selection means no default is applied.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-8">
        {GEOGRAPHIC_OPTIONS.map(({ code, label, phase }) => (
          <SelectionCard key={code} selected={selected.includes(code)} onClick={() => onToggle(code)}>
            <div className="text-sm font-medium pr-6">{label}</div>
            {phase > 1 && (
              <div className="text-xs font-mono text-gray-600 mt-1">Phase {phase}</div>
            )}
          </SelectionCard>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onBack} size="lg">Back</Button>
        <Button onClick={onComplete} disabled={saving} size="lg">
          {saving ? 'Saving…' : 'Enter Terminal'}
        </Button>
      </div>
    </div>
  )
}
