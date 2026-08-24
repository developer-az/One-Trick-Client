/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'pyke-green': '#d4d8de',
        'pyke-green-dim': '#8b9098',
        'pyke-dark': '#0b0c0e',
        'pyke-dark-light': '#141518',
        'pyke-accent': '#1c1c20',
        'blood-red': '#e85d4c',
        'gold': '#e8b84a',
        'gold-dim': '#b4923a',
        'neon-blue': '#aeb4be',
        'chrome-silver': '#d4d8de',
        'chrome-bright': '#f2f4f7',
        'chrome-dim': '#8b9098',
        'chrome-ink': '#0b0c0e',
        'chrome-blood': '#e85d4c',
        'chrome-gold': '#e8b84a',
      },
      fontFamily: {
        'display': ['Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        'sans': ['Segoe UI Variable', 'Segoe UI', 'system-ui', 'sans-serif'],
        'mono': ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      }
    },
  },
  plugins: [],
}
