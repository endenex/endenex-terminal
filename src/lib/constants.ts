import type { UserCohort, AssetClass } from './types'

export const COHORT_LABELS: Record<UserCohort, string> = {
  developer_originator: 'Developer / Asset Originator',
  fund_manager: 'Fund Manager / Asset Owner',
  lender: 'Lender / Debt Provider',
  surety_underwriter: 'Surety Underwriter / Insurer',
  decom_contractor: 'Decommissioning Contractor',
  recycler_processor: 'Recycler / Processor',
  commodity_trader: 'Commodity Trader / Material Broker',
  ma_advisor: 'M&A Advisor / Banker',
  operator: 'Operator / Asset Manager',
  regulator: 'Regulator / Government',
}

export const COHORT_DESCRIPTIONS: Record<UserCohort, string> = {
  developer_originator: 'Repowering pipeline and site origination',
  fund_manager: 'ARO benchmarking and portfolio oversight',
  lender: 'Reserve sizing and debt structuring',
  surety_underwriter: 'Bond pricing and decommissioning risk',
  decom_contractor: 'Forward pipeline and campaign visibility',
  recycler_processor: 'Material volumes and recovery outlook',
  commodity_trader: 'Forward supply curves from clean energy retirement',
  ma_advisor: 'Diligence benchmarking and liability assessment',
  operator: 'End-of-life planning and independent reference data',
  regulator: 'Market activity monitoring and oversight',
}

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  onshore_wind: 'Onshore Wind',
  solar_pv: 'Solar PV',
  bess: 'Battery Energy Storage',
  offshore_wind: 'Offshore Wind',
}

export const ASSET_CLASS_PHASE: Record<AssetClass, number> = {
  onshore_wind: 1,
  solar_pv: 2,
  bess: 3,
  offshore_wind: 4,
}

export const GEOGRAPHIC_OPTIONS = [
  { code: 'EU', label: 'Europe (Aggregated)', phase: 1 },
  { code: 'US', label: 'United States', phase: 1 },
  { code: 'DE', label: 'Germany', phase: 1 },
  { code: 'GB', label: 'United Kingdom', phase: 1 },
  { code: 'DK', label: 'Denmark', phase: 2 },
  { code: 'FR', label: 'France', phase: 2 },
  { code: 'ES', label: 'Spain', phase: 2 },
]
