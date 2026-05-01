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
        // Semantic tokens used by Chip, StatePill, code blocks. Theme overrides
        // in index.css remap these per theme (paper/frost) for legible contrast.
        warning: 'hsl(45, 90%, 75%)',
        multiplier: 'hsl(280, 70%, 90%)',
        field: 'hsl(217, 80%, 80%)',
        value: 'hsl(45, 90%, 90%)',
        codeblock: 'hsl(217, 80%, 82%)',
        // Hover variant of `accent` for dark theme.
        'accent-hover': 'hsl(217, 100%, 75%)',
        // Pill background tints (low-opacity tone halos).
        'pill-pos': 'hsla(142, 60%, 30%, 0.20)',
        'pill-pos-border': 'hsla(142, 60%, 30%, 0.40)',
        'pill-warn': 'hsla(45, 70%, 30%, 0.20)',
        'pill-warn-border': 'hsla(45, 70%, 30%, 0.50)',
        'pill-neg': 'hsla(0, 60%, 30%, 0.20)',
        'pill-neg-border': 'hsla(0, 60%, 30%, 0.50)',
        'pill-accent': 'hsla(217, 80%, 55%, 0.18)',
        'pill-accent-border': 'hsla(217, 80%, 55%, 0.40)',
        // Chip surface tints (used by ConditionRow/Chip).
        'chip-field': 'hsla(217, 40%, 40%, 0.20)',
        'chip-field-border': 'hsla(217, 40%, 40%, 0.40)',
        'chip-value': 'hsla(45, 60%, 30%, 0.25)',
        'chip-value-border': 'hsla(45, 60%, 30%, 0.50)',
        'chip-mult': 'hsla(280, 40%, 40%, 0.20)',
        'chip-mult-border': 'hsla(280, 40%, 40%, 0.40)',
        // Warning banner surface (used by RulePreview/ColumnPreview).
        'warn-banner': 'hsla(45, 70%, 30%, 0.10)',
        'warn-banner-border': 'hsla(45, 70%, 30%, 0.40)',
      },
    },
  },
  plugins: [],
};
