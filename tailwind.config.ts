import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Light surface palette ─────────────────────────────────────────────
        page:     '#F4F5F7',   // cool grey — workspace background
        canvas:   '#FAFBFC',   // near-white — sub-panel areas
        panel:    '#FFFFFF',   // white — panel surfaces
        titlebar: '#EFF1F4',   // light grey — panel titlebars
        active:   '#E6F2F4',   // teal-tinted — active state surfaces

        // ── Borders (light context) ───────────────────────────────────────────
        border: {
          DEFAULT: '#E5E8EC',
          strong:  '#D0D5DB',
          focus:   '#007B8A',
        },

        // ── Text (light context) ──────────────────────────────────────────────
        ink: {
          DEFAULT: '#0A1628',   // primary — brand navy
          '2':     '#4A5566',   // secondary
          '3':     '#6B7585',   // tertiary
          '4':     '#98A1AE',   // quaternary
        },

        // ── Top chrome (dark navy anchor) ─────────────────────────────────────
        chrome: {
          bg:     '#0A1628',
          raised: '#122035',
          text:   '#E8EAED',
          muted:  '#A0A9B7',
          border: '#1F2D40',
        },

        // ── Accents ───────────────────────────────────────────────────────────
        teal: {
          DEFAULT: '#007B8A',
          bright:  '#14A4B4',
          deep:    '#005966',
        },

        // ── Data colours (institutional — muted, not retail) ──────────────────
        up:        '#1F8A5C',
        down:      '#B53C3C',
        highlight: '#C77E0A',

        // ── Role label colours ────────────────────────────────────────────────
        product: '#C77E0A',   // amber — Product tabs (DCI, Portfolio)
        moat:    '#007B8A',   // teal  — Processing Capacity Monitor

        // ── Legacy terminal-* aliases (kept so older component refs don't break)
        terminal: {
          black:        '#F4F5F7',   // remapped → page bg (was dark)
          surface:      '#FFFFFF',   // remapped → panel white
          border:       '#E5E8EC',   // remapped → light border
          text:         '#0A1628',   // remapped → primary ink
          muted:        '#6B7585',   // remapped → tertiary ink
          teal:         '#007B8A',
          'teal-light': '#14A4B4',
          navy:         '#0A1628',
          'navy-light': '#122035',
          'navy-border':'#1F2D40',
          grey:         '#F4F5F7',
          'grey-dark':  '#E8E9EC',
          white:        '#FFFFFF',
          red:          '#B53C3C',
          green:        '#1F8A5C',
        },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'],   // no code fonts
      },

      boxShadow: {
        panel:       '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'panel-md':  '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        'panel-float':'0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config
