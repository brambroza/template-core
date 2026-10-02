import { defineConfig } from 'vitest/config';

/** Automated UAT run (see tests/uat). Sequential: one installation, cases build on each other. */
export default defineConfig({
  test: {
    include: ['tests/uat/**/*.test.ts'],
    testTimeout: 90000,
    hookTimeout: 180000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
