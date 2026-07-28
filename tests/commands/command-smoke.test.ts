import { describe, expect, it } from 'vitest';
import { checks, setup, steps } from './testkit';

const CORE_COMMANDS = [
  'editing.node.create',
  'editing.edge.create',
  'palette.open',
  'view.zen',
  'graph.share.copy',
  'graph.import.paste',
];

describe('command smoke', () => {
  it('keeps essential commands registered', () => {
    const ctx = setup.app();
    const missing = CORE_COMMANDS.filter(id => !ctx.contexts.commands.get(id));
    expect(missing).toEqual([]);
  });

  it('runs representative auto commands without DX errors', async () => {
    for (const id of ['editing.node.create', 'demo.render-self']) {
      const ctx = setup.app();
      await steps.settle();
      steps.command(ctx, id);
      await steps.settle();
      checks.noDxErrors(ctx, id);
    }
  });
});
