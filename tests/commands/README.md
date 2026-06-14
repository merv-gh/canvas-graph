# Command Tests

Fast frontend tests live here. They boot the real frontend registries in jsdom with in-memory IO,
then drive the app through commands and events.

Pattern:

```ts
import { bootApp, runCommand, settle } from './testkit';

it('does the thing', async () => {
  const ctx = bootApp();
  runCommand(ctx, 'editing.node.create');
  await settle();
  expect(ctx.graphs.current.nodes()).toHaveLength(1);
});
```

Use these for command behavior, feature orchestration, model mutations, modal/form
flows, and render-adjacent DOM checks. Use Playwright when the case needs browser
layout, screenshots, pointer fidelity, or full Vite serving.

Scripts:

- `npm run test:commands`
- `npm run test:commands:coverage`
- `npm test` runs command coverage first, then Playwright.

Coverage is frontend-only and enforced at 80% global thresholds for statements,
functions, and lines. Branch coverage is reported too; keep raising it as branchy
fallback paths become clearer to test.
