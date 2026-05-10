/**
 * Design-life store — shared between ARI retirement panels and the
 * Recycling Capacity Monitor's Waste Flow Forecast panel.
 *
 * One source of truth for "median design life (years)" per asset class.
 * ARI sliders write to this store. The WFF panel reads from it.
 * Drag a slider in ARI → both ARI panel AND WFF panel update in lockstep.
 *
 * Defaults match the ARI RET_SPECS sliderDefault values (wind 22y,
 * solar 25y, BESS 12y). Values persisted to localStorage so they
 * survive page reload / navigation.
 *
 * Slider bounds (also for WFF tooltips / context):
 *   wind:  18-25 years
 *   solar: 20-30 years
 *   bess:  11-15 years
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DesignLifeState {
  windMedianYears:  number
  solarMedianYears: number
  bessMedianYears:  number
  setWind:  (y: number) => void
  setSolar: (y: number) => void
  setBess:  (y: number) => void
  /** Bulk reset to defaults (wind 22 / solar 25 / BESS 12) */
  reset:    () => void
}

export const DESIGN_LIFE_DEFAULTS = {
  wind:  22,
  solar: 25,
  bess:  12,
} as const

export const DESIGN_LIFE_BOUNDS = {
  wind:  { min: 18, max: 25 },
  solar: { min: 20, max: 30 },
  bess:  { min: 11, max: 15 },
} as const

export const useDesignLife = create<DesignLifeState>()(
  persist(
    (set) => ({
      windMedianYears:  DESIGN_LIFE_DEFAULTS.wind,
      solarMedianYears: DESIGN_LIFE_DEFAULTS.solar,
      bessMedianYears:  DESIGN_LIFE_DEFAULTS.bess,
      setWind:  (y) => set({ windMedianYears:  y }),
      setSolar: (y) => set({ solarMedianYears: y }),
      setBess:  (y) => set({ bessMedianYears:  y }),
      reset:    () => set({
        windMedianYears:  DESIGN_LIFE_DEFAULTS.wind,
        solarMedianYears: DESIGN_LIFE_DEFAULTS.solar,
        bessMedianYears:  DESIGN_LIFE_DEFAULTS.bess,
      }),
    }),
    { name: 'endenex.design-life' },
  ),
)
