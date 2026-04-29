/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'JetBrains Mono', 'IBM Plex Mono', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        bg: {
          0: '#0a0b0e',
          1: '#0e1014',
          2: '#14171c',
          3: '#1b1f26',
          4: '#242932',
        },
        line: {
          DEFAULT: '#1f242c',
          2: '#2a3038',
        },
        ink: {
          DEFAULT: '#e6e8eb',
          2: '#a8aeb8',
          3: '#6c7480',
          4: '#4a515b',
        },
        pos: '#4ade80',
        neg: '#f87171',
        accent: '#6ea8ff',
      },
    },
  },
  plugins: [],
};
