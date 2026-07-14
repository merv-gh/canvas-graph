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
        // Experimental embed API is not part of the 0.1 static-app release.
        'frontend/lib.ts',
        'frontend/systems/varflow.ts',
        // WebGPU device plumbing — needs a real GPU; jsdom has no navigator.gpu.
        // The CPU side (core/gpu-scene.ts) stays covered; the device path is
        // verified in-browser via `app.gpuStage.probe()` pixel readback.
        'frontend/systems/render-stage-gpu.ts',
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
