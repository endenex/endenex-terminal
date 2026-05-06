import type { Config } from 'tailwindcss'

// ── Endenex Terminal — design tokens v3 ──────────────────────────────────────
// BloombergNEF-style light palette. White panels on cool-grey workspace, deep
// navy ink, BNEF-amber + teal accents. Dense layout, sharp 1px borders, no
// shadows, readable type (13px base).

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Surfaces (light stack) ───────────────────────────────────────────
        page:     '#F2F4F7',   // workspace background — cool grey
        canvas:   '#FAFBFC',   // toolbar / strip backgrounds — near-white
        panel:    '#FFFFFF',   // primary panel surface
        titlebar: '#F4F6F9',   // panel header — distinct from panel
        active:   '#E4F1F3',   // selected / active — teal-tinted
        raised:   '#F7F9FB',   // hover states

        // ── Borders ──────────────────────────────────────────────────────────
        border: {
          DEFAULT: '#D6DBE0',   // visible, sharp — not the wishy-washy E5
          strong:  '#B5BCC4',
          focus:   '#0E7A86',
        },

        // ── Text ─────────────────────────────────────────────────────────────
        ink: {
          DEFAULT: '#0A1628',   // primary — deep navy, near-black
          '2':     '#3D4759',   // secondary
          '3':     '#6B7585',   // tertiary
          '4':     '#98A1AE',   // quaternary — labels, units
          '5':     '#C5CBD3',   // disabled / placeholder
        },

        // ── Top chrome (deep navy anchor for brand) ───────────────────────────
        chrome: {
          bg:     '#0A1628',
          raised: '#152238',
          text:   '#E8EAED',
          muted:  '#A0A9B7',
          border: '#1F2D40',
        },

        // ── Accents (deeper for light bg contrast) ────────────────────────────
        teal: {
          DEFAULT: '#0E7A86',   // primary teal — readable on white
          bright:  '#14A4B4',
          deep:    '#0A5C66',
          dim:     '#E4F1F3',
        },
        amber: {
          DEFAULT: '#D97706',   // BNEF-style orange/amber
          bright:  '#F59E0B',
          dim:     '#FEF3E2',
        },

        // ── Data colours (institutional — saturated for white bg) ─────────────
        up:        '#0F8B58',
        'up-dim':  '#E6F4EC',
        down:      '#C73838',
        'down-dim':'#FBE9E9',
        highlight: '#D97706',

        // ── Role label colours ────────────────────────────────────────────────
        product: '#D97706',
        moat:    '#0E7A86',

        // ── Legacy terminal-* aliases (light context) ─────────────────────────
        terminal: {
          black:        '#F2F4F7',
          surface:      '#FFFFFF',
          border:       '#D6DBE0',
          text:         '#0A1628',
          muted:        '#6B7585',
          teal:         '#0E7A86',
          'teal-light': '#14A4B4',
          navy:         '#0A1628',
          'navy-light': '#152238',
          'navy-border':'#1F2D40',
          grey:         '#F2F4F7',
          'grey-dark':  '#E8EAED',
          white:        '#FFFFFF',
          red:          '#C73838',
          green:        '#0F8B58',
        },
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'],
      },

      fontSize: {
        // Terminal-tuned scale — denser than tailwind defaults but readable
        '2xs':  ['10.5px', { lineHeight: '14px' }],
        'xs':   ['11.5px', { lineHeight: '15px' }],
        'sm':   ['12.5px', { lineHeight: '17px' }],
        'base': ['13.5px', { lineHeight: '19px' }],
        'lg':   ['15px',   { lineHeight: '21px' }],
        'xl':   ['17px',   { lineHeight: '23px' }],
        '2xl':  ['20px',   { lineHeight: '26px' }],
      },

      // Sharp 1px borders, no soft shadows on panels.
      // Floating overlays get a single subtle one.
      boxShadow: {
        panel:        'none',
        'panel-md':   'none',
        'panel-float':'0 8px 32px rgba(10,22,40,0.14), 0 2px 8px rgba(10,22,40,0.06)',
      },

      borderRadius: {
        DEFAULT: '2px',
        sm:      '2px',
        md:      '3px',
        lg:      '4px',
      },
    },
  },
  plugins: [],
} satisfies Config
