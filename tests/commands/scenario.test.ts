import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';
import { parseScenario } from '../../frontend/systems/scenario';

/** The scenario player replays a keystroke macro through the real input router —
 *  the engine behind shareable `?scenario=` reproductions and fix demos. */
describe('scenario player', () => {
  it('tokenizes keys, quoted strings, and wait', () => {
    expect(parseScenario('A;A;E;a;b')).toEqual([
      { kind: 'key', value: 'A' }, { kind: 'key', value: 'A' }, { kind: 'key', value: 'E' },
      { kind: 'key', value: 'a' }, { kind: 'key', value: 'b' },
    ]);
    expect(parseScenario('A;"Hello world";wait;Enter')).toEqual([
      { kind: 'key', value: 'A' }, { kind: 'type', value: 'Hello world' },
      { kind: 'wait' }, { kind: 'key', value: 'Enter' },
    ]);
  });

  it('replays keystrokes as real commands (A creates nodes)', async () => {
    const ctx = bootApp();
    await settle();
    // speed 0 → steps fire back-to-back on the macrotask queue.
    ctx.scenario!.play('A;A;A', { speed: 0 });
    // Each step is a setTimeout; drain them.
    for (let i = 0; i < 8; i++) await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(3);
  });

  it('mounts a progress HUD while playing and clears nothing prematurely', async () => {
    const ctx = bootApp();
    await settle();
    ctx.scenario!.play('A;A', { speed: 0 });
    await settle();
    const hud = ctx.contexts.places.el('top')?.parentElement?.querySelector('.scenario-hud');
    expect(hud).not.toBeNull();
  });

  it('drives the zen toggle through the same path the bug-demo uses', async () => {
    const ctx = bootApp();
    await settle();
    ctx.scenario!.play('\\', { speed: 0 });
    for (let i = 0; i < 4; i++) await settle();
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(true);
  });
});
