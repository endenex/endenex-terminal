import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        terminal: {
          navy: '#0A1628',
          'navy-light': '#1A2E4A',
          'navy-border': '#243B5E',
          teal: '#007B8A',
          'teal-light': '#0B9AAD',
          grey: '#F4F5F7',
          'grey-dark': '#E8E9EC',
          white: '#FFFFFF',
          red: '#C0392B',
          green: '#1A7C4A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
