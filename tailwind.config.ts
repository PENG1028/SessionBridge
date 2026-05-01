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
    },
  },
  plugins: [],
};

export default config;
