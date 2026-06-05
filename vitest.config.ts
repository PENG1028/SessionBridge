import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'lib/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: [],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
