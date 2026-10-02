import { defineConfig } from 'vitest/config';

/** Browser tests: real services + gateway + built web app + Chromium. Run with `pnpm test:ui`. */
export default defineConfig({
  test: {
    include: ['tests/ui-e2e/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
