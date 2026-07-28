import { defineConfig } from 'vitest/config';

// High-signal developer lane. Exhaustive matrices, UX permutations, and
// performance probes stay in `test:commands:full` and the release gate.
export default defineConfig({
  test: {
    environment: 'jsdom',
    isolate: false,
    include: [
      'tests/commands/model-core.test.ts',
      'tests/commands/command-smoke.test.ts',
      'tests/commands/journey-smoke.test.ts',
      'tests/commands/architecture-journey.test.ts',
      'tests/commands/redraw-convention.test.ts',
      'tests/commands/recorded/reverse-edge.test.ts',
    ],
    setupFiles: ['tests/commands/setup.ts'],
    coverage: {
      provider: 'v8',
      // Local coverage gates the event/model/render core exercised above.
      // Release still gates persistence, telemetry, and every other source.
      all: true,
      include: [
        'frontend/runtime.ts',
        'frontend/core/{bus,commands,flags,frame-loop,geometry,model-registry,redraw}.ts',
        'frontend/model/**/*.ts',
        'frontend/systems/{command-picker,render}.ts',
      ],
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage/frontend-fast',
      thresholds: {
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
