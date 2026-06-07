import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/commands/**/*.test.ts'],
    setupFiles: ['tests/commands/setup.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['v2/**/*.ts'],
      exclude: [
        'v2/app.ts',
        'v2/types.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/v2',
      thresholds: {
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
