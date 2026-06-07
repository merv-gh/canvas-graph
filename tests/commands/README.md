# Command Tests

Fast v2 tests live here. They boot the real v2 registries in jsdom with in-memory IO,
then drive the app through commands and events.

Pattern:

```ts
import { bootV2, runCommand, settle } from './v2-testkit';

it('does the thing', async () => {
  const ctx = bootV2();
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

Coverage is v2-only and enforced at 80% global thresholds for statements,
functions, and lines. Branch coverage is reported too; keep raising it as branchy
fallback paths become clearer to test.
