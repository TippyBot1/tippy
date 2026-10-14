import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // The property tests run thousands of cases; on a busy machine they need more than 5s.
    testTimeout: 30_000,
    coverage: { include: ['src/engine/**'] },
  },
});
