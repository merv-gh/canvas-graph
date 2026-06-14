// Scripted actor — proves the RED→GREEN→VERIFY plumbing end-to-end with zero
// model involvement: `node dx/ollama-runner/loop.mjs --task zen-canvas --mock`.
// Each entry is the normalized reply OllamaChat would have produced.

const ZEN_TEST = `import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootApp, settle } from '../testkit';

describe('zen mode keeps stage visible', () => {
  it('stage is pinned to grid-row 2 so zen cannot collapse it', () => {
    const css = readFileSync(resolve(process.cwd(), 'frontend/styles.css'), 'utf8');
    const block = css.match(/\\.stage\\s*\\{([^}]+)\\}/)?.[1] ?? '';
    expect(block.match(/grid-row\\s*:\\s*([^;]+);/)?.[1]?.trim()).toBe('2');
  });
  it('zen toggle round-trips and stage stays mounted', async () => {
    const ctx = bootApp();
    await settle();
    ctx.sim.replay([{ name: 'fold.toggle', data: { id: 'shell.zen' }, at: 0 }]);
    await settle();
    expect(ctx.contexts.places.el('stage')).toBeTruthy();
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(true);
  });
});
`;

const SCRIPTS = {
  'zen-canvas': [
    { kind: 'tool', name: 'read', args: { path: 'frontend/styles.css', from: 175, lines: 20 } },
    { kind: 'tool', name: 'write', args: { path: 'tests/commands/dx/zen-canvas.test.ts', content: ZEN_TEST } },
    { kind: 'tool', name: 'run_test', args: { path: 'tests/commands/dx/zen-canvas.test.ts' } },
    { kind: 'tool', name: 'done', args: { summary: 'red test fails: stage has no grid-row pin' } },
    // --- harness flips to GREEN here ---
    { kind: 'tool', name: 'edit', args: { path: 'frontend/styles.css', old: '  grid-column: 2;\n  --grid-size', new: '  grid-column: 2;\n  grid-row: 2;\n  --grid-size' } },
    { kind: 'tool', name: 'run_test', args: { path: 'tests/commands/dx/zen-canvas.test.ts' } },
    { kind: 'tool', name: 'done', args: { summary: 'stage pinned to row 2' } },
  ],
};

export class MockChat {
  constructor(taskId, log = () => {}) {
    this.script = [...(SCRIPTS[taskId] ?? [])];
    this.log = log;
  }
  async chat() {
    const next = this.script.shift();
    if (!next) return { kind: 'tool', name: 'give_up', args: { reason: 'mock script exhausted' } };
    this.log(`[mock] ${next.name}`);
    return next;
  }
}
