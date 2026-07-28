const { defineConfig } = require('@playwright/test');
const fullConfig = require('./playwright.config.cjs');

// Cross-layer browser smoke for local feedback. Full journeys remain in
// `test:browser:full` and the release gate.
module.exports = defineConfig({
  ...fullConfig,
  workers: 2,
  testMatch: [
    'abilities.spec.js',
    'dx-layout.spec.ts',
    'edge-creation.spec.js',
    'flags.spec.js',
  ],
  grep: /@smoke/,
});
