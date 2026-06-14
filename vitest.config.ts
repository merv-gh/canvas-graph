import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/commands/**/*.test.ts'],
    setupFiles: ['tests/commands/setup.ts'],
    coverage: {
      provider: 'v8',
      all: true,
      include: ['frontend/**/*.ts'],
      exclude: [
        'frontend/app.ts',
        'frontend/types.ts',
      ],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage/frontend',
      thresholds: {
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
