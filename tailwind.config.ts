import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cockpit: {
          950: '#05080c',
          900: '#09111b',
          800: '#0e1a28',
          700: '#142437',
        },
        radar: {
          500: '#22c55e',
          400: '#4ade80',
          300: '#86efac',
        },
        amber: {
          400: '#fbbf24',
          500: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
