/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Chrome Hearts silver (legacy pyke-green keys remapped for existing classNames)
        'pyke-green': '#d4d8de',
        'pyke-green-dim': '#8a919c',
        'pyke-dark': '#070708',
        'pyke-dark-light': '#121214',
        'pyke-accent': '#1c1c20',
        'blood-red': '#9b1c2e',
        'gold': '#e8eaee',
        'gold-dim': '#9aa1ab',
        'neon-blue': '#aeb4be',
        'chrome-silver': '#d4d8de',
        'chrome-bright': '#f2f4f7',
        'chrome-dim': '#8a919c',
        'chrome-ink': '#070708',
        'chrome-blood': '#9b1c2e',
      },
      fontFamily: {
        'display': ['Cinzel', 'Times New Roman', 'serif'],
        'sans': ['Syne', 'Segoe UI', 'sans-serif'],
        'mono': ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      }
    },
  },
  plugins: [],
}
