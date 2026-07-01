import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

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
    const ctx = bootApp();
    const missing = CORE_COMMANDS.filter(id => !ctx.contexts.commands.get(id));
    expect(missing).toEqual([]);
  });

  it('runs representative auto commands without DX errors', async () => {
    for (const id of ['editing.node.create', 'demo.render-self']) {
      const ctx = bootApp();
      await settle();
      runCommand(ctx, id);
      await settle();
      expect(ctx.dx?.run().filter(issue => issue.level === 'error'), id).toEqual([]);
    }
  });
});
