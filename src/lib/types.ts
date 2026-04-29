export type AssetClass = 'onshore_wind' | 'solar_pv' | 'bess' | 'offshore_wind'

export type ConfidenceLevel = 'High' | 'Medium' | 'Low'

export type Derivation = 'Observed' | 'Inferred' | 'Modelled'

export type OverallClassification = 'Watchlist' | 'Candidate' | 'Active' | 'Confirmed'

export type UserCohort =
  | 'developer_originator'
  | 'fund_manager'
  | 'lender'
  | 'surety_underwriter'
  | 'decom_contractor'
  | 'recycler_processor'
  | 'commodity_trader'
  | 'ma_advisor'
  | 'operator'
  | 'regulator'

export interface SourceMetadata {
  source_type: string
  source_date: string
  confidence: ConfidenceLevel
  derivation: Derivation
  last_reviewed: string
  signal_type?: string
}

export interface ConfidenceInterval {
  low: number
  mid: number
  high: number
  currency?: string
  unit?: string
}

export type RepoweringStage =
  | 'announced'
  | 'application_submitted'
  | 'application_approved'
  | 'permitted'
  | 'ongoing'

export interface RepoweringProject {
  id: string
  project_name: string
  country_code: string
  asset_class: AssetClass
  stage: RepoweringStage
  stage_date: string | null
  capacity_mw: number | null
  turbine_count: number | null
  developer: string | null
  operator: string | null
  planning_reference: string | null
  location_description: string | null
  source_url: string | null
  notes: string | null
  asset_id: string | null
  source_type: string
  source_date: string
  confidence: ConfidenceLevel
  derivation: Derivation
  last_reviewed: string
  created_at: string
  updated_at: string
}

export interface UserProfile {
  id: string
  clerk_user_id: string
  cohort: UserCohort | null
  asset_class_interest: AssetClass[]
  geographic_focus: string[]
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}
