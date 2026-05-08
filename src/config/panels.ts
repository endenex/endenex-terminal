// ── Tab / panel registry ────────────────────────────────────────────────────
// Order matches Product Brief v1.0 §4.1 exactly.

export type PanelId = 'home' | 'dci' | 'ari' | 'smi' | 'pcm' | 'portfolio' | 'watch'

export interface PanelMeta {
  title:     string
  role:      string
  roleColor: 'default' | 'product' | 'moat'
}

export const PANELS: Record<PanelId, PanelMeta> = {
  home: {
    title:     'Home',
    role:      'Dashboard',
    roleColor: 'default',
  },
  dci: {
    title:     'DCI Dashboard',
    role:      'Product',
    roleColor: 'product',
  },
  ari: {
    title:     'Asset Retirement Intelligence',
    role:      'Module',
    roleColor: 'default',
  },
  smi: {
    title:     'Secondary Materials Intelligence',
    role:      'Module',
    roleColor: 'default',
  },
  pcm: {
    title:     'Recycling Capacity Monitor',
    role:      'Module · Moat spine',
    roleColor: 'moat',
  },
  portfolio: {
    title:     'Portfolio Analytics',
    role:      'Product',
    roleColor: 'product',
  },
  watch: {
    title:     'Market Watch',
    role:      'Module',
    roleColor: 'default',
  },
}

export const PANEL_ORDER: PanelId[] = [
  'home', 'dci', 'ari', 'smi', 'pcm', 'watch', 'portfolio',
]
