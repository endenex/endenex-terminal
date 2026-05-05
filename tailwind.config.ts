import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        terminal: {
          // Sidebar / brand
          navy: '#0A1628',
          'navy-light': '#1A2E4A',
          'navy-border': '#243B5E',
          // Accent
          teal: '#007B8A',
          'teal-light': '#0B9AAD',
          // Dark workspace theme
          black: '#0D1117',       // workspace background
          surface: '#161B22',     // panel / card surfaces
          border: '#21262D',      // gridlines / dividers
          text: '#E6EDF3',        // primary text
          muted: '#7D8590',       // secondary / label text
          // Legacy (auth pages only)
          grey: '#F4F5F7',
          'grey-dark': '#E8E9EC',
          white: '#FFFFFF',
          red: '#C0392B',
          green: '#1A7C4A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'],  // no code fonts — tabular-nums handles alignment
      },
    },
  },
  plugins: [],
} satisfies Config
