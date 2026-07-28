import { defineConfig, mergeConfig } from 'vitest/config';
import { coverageCommandTests } from './tests/test-lanes';
import fastConfig from './vitest.fast.config';

export default mergeConfig(fastConfig, defineConfig({
  test: {
    include: coverageCommandTests,
  },
}));
