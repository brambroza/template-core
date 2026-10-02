import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts', 'tests/e2e/**/*.test.ts', 'tests/ui/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: true,
  },
});
