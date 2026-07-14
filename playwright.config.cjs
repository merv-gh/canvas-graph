const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testIgnore: ['**/commands/**', '**/bench/**'],
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['./tests/screenshot-reporter.cjs']],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    // Browser tests need the app only. The default dev command also starts DX
    // projection watchers, which compete with timing-sensitive test processes.
    command: 'npm run dev:frontend',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
