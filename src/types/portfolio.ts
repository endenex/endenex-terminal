// ── Shared portfolio types ──────────────────────────────────────────────────

export type AssetClass = 'onshore_wind' | 'offshore_wind' | 'solar_pv' | 'bess'

export interface PortfolioAsset {
  id:                 string
  site_name:          string
  country_code:       string
  asset_class:        AssetClass
  capacity_mw:        number
  turbine_count:      number | null
  commissioning_year: number
  operator:           string
  notes:              string

  // Optional turbine identification — enables turbine-specific NRO attribution
  turbine_make:       string | null
  turbine_model:      string | null
}
