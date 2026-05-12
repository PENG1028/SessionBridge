import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        term: {
          bg: '#0d1117',
          fg: '#e6edf3',
          accent: '#58a6ff',
          border: '#30363d',
        },
      },
      fontFamily: {
        mono: ['Menlo', 'Monaco', '"Courier New"', 'monospace'],
      },
      keyframes: {
        'slide-in': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
