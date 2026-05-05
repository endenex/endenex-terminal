// ── Panel registry ─────────────────────────────────────────────────────────────
// Kept in its own file to avoid circular imports between AppShell and NavBar.

export type PanelId = 'home' | 'dci' | 'retirement' | 'materials' | 'blades' | 'watch' | 'portfolio'

export const PANELS: Record<PanelId, { title: string }> = {
  home:       { title: 'Home' },
  dci:        { title: 'DCI' },
  retirement: { title: 'Asset Retirement' },
  materials:  { title: 'Recovery Value' },
  blades:     { title: 'Blade Intelligence' },
  watch:      { title: 'Market Watch' },
  portfolio:  { title: 'Portfolio' },
}
