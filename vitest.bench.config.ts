import { defineConfig } from 'vitest/config';

/** Separate config so the perf bench never runs inside the fast command suite
 *  (no coverage gates, long timeout, single fork — sizes must run in order). */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/bench/**/*.test.ts'],
    setupFiles: ['tests/commands/setup.ts'],
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
