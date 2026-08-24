/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        chrome: {
          ink: '#0b0c0e',
          panel: '#141518',
          silver: '#d4d8de',
          bright: '#f2f4f7',
          dim: '#8b9098',
          blood: '#e85d4c',
          gold: '#e8b84a',
          line: 'rgba(255, 255, 255, 0.08)',
        },
      },
      fontFamily: {
        display: ['Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        sans: ['Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(28px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-line': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.85' },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -12px, 0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.9s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-line': 'pulse-line 4s ease-in-out infinite',
        drift: 'drift 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
