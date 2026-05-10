/**
 * Endenex chart-style defaults.
 *
 * Single source of truth for Recharts axes / grid / tooltip / legend
 * styling and brand-aligned color palettes. Use these in every chart
 * instead of inline tick / stroke values so the look-and-feel stays
 * consistent across pages.
 *
 * Endenex brand palette:
 *   navy   #0A1628  (primary, dark labels + first series)
 *   teal   #007B8A  (primary accent, second series, axis hover)
 *   gold   #C4863A  (highlight accent, third series)
 *   cream  #F7F4EF  (panel cream wash)
 *   rule   #D8D3CB  (border / grid lines)
 *   grey   #8C8880  (muted text)
 *
 * Extended series palette adds tints/shades for charts with many
 * categories (materials, regions, asset classes).
 */

// ── Core brand colors ──────────────────────────────────────────────────

export const ENDENEX = {
  navy:   '#0A1628',
  teal:   '#007B8A',
  gold:   '#C4863A',
  cream:  '#F7F4EF',
  rule:   '#D8D3CB',
  grey:   '#8C8880',
  // Brand state colors
  up:     '#0F8B58',  // muted emerald (used in scrap merchant up-tick / FRED gain)
  down:   '#C73838',  // muted red (down-tick / waste)
  amber:  '#C4863A',  // alias of gold for warnings
} as const

// ── Multi-series palette ──────────────────────────────────────────────
// 15 distinguishable colors built from the brand palette + tints. Used
// when a chart needs to show many categories (countries, materials,
// asset classes). Order matters — first 3 are the brand primaries so
// 2-3 series charts stay strongly on-brand.

export const SERIES_PALETTE = [
  '#0A1628',  // 1.  navy (brand primary)
  '#007B8A',  // 2.  teal (brand accent)
  '#C4863A',  // 3.  gold accent
  '#4A9BAA',  // 4.  light teal
  '#1C3D52',  // 5.  dark teal-navy
  '#2A7F8E',  // 6.  mid teal
  '#3D6E7A',  // 7.  teal-grey
  '#5A8A95',  // 8.  soft teal
  '#6BAAB5',  // 9.  pale teal
  '#1E5060',  // 10. deep navy-teal
  '#345F6A',  // 11. medium navy-teal
  '#9BB5BB',  // 12. very pale teal
  '#007B60',  // 13. teal-green
  '#8C8880',  // 14. warm grey
  '#9B3A3A',  // 15. red (sparing — waste / negative)
] as const

// ── Material-specific palette (waste flow charts) ────────────────────
// Mapped to the brand palette. Stable across pages so users learn the
// associations: composite always red, black mass always navy, etc.

export const MATERIAL_BRAND_COLORS: Record<string, string> = {
  // Specialist recycling streams (PCM Waste Flow Forecast)
  composite:    '#9B3A3A',  // red — waste-treatment, no recovery
  black_mass:   '#0A1628',  // navy — primary commodity output
  rare_earth:   '#C4863A',  // gold — scarce critical material
  silver:       '#9BB5BB',  // very pale teal — silvery
  silicon:      '#1C3D52',  // dark teal-navy — wafer
  glass:        '#4A9BAA',  // light teal — translucent
  // Scrap-merchant streams (SMI Decom Material Volume)
  steel:        '#3D6E7A',  // teal-grey — workhorse metal
  cast_iron:    '#5A8A95',  // soft teal
  copper:       '#C4863A',  // gold/copper-tone
  aluminium:    '#6BAAB5',  // pale teal — light non-ferrous
  zinc:         '#8C8880',  // warm grey
  // Hidden (no recovery, but defined defensively for any caller)
  polymer:      '#9B9B9B',  // dim grey
  electrolyte:  '#7C7C7C',  // mid grey
} as const

// ── Default Recharts component props ─────────────────────────────────

/** Standard axis tick style — small grey-ish text, brand-toned. */
export const AXIS_TICK = { fontSize: 9, fill: ENDENEX.grey } as const

/** Standard axis line — thin rule-color. */
export const AXIS_LINE = { stroke: ENDENEX.rule } as const

/** Standard CartesianGrid — light dashed horizontal-only lines. */
export const GRID_PROPS = {
  strokeDasharray: '2 4',
  stroke:          ENDENEX.rule,
  vertical:        false,
} as const

/** Standard tooltip card style. */
export const TOOLTIP_CONTENT_STYLE = {
  fontSize:     10,
  padding:      '4px 8px',
  borderRadius: 2,
  border:       `1px solid ${ENDENEX.rule}`,
  background:   '#FFFFFF',
  color:        ENDENEX.navy,
} as const

export const TOOLTIP_LABEL_STYLE = {
  fontSize:     10,
  fontWeight:   600,
  color:        ENDENEX.navy,
} as const

export const TOOLTIP_ITEM_STYLE = {
  fontSize:     10,
  color:        ENDENEX.navy,
} as const

/** Standard legend wrapper. */
export const LEGEND_PROPS = {
  wrapperStyle: { fontSize: 9, paddingTop: 2, color: ENDENEX.navy } as React.CSSProperties,
  iconSize:     7,
} as const
