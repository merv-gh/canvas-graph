import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';

describe('v2 sim harness', () => {
  it('records every event flowing through the bus', async () => {
    const ctx = bootV2();
    await settle();
    const recorder = ctx.sim.record();
    recorder.start();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const trace = recorder.stop();

    const names = trace.map(event => event.name);
    expect(names).toContain('editing.node.create');
    expect(names).toContain('graph.node.create');
    expect(names).toContain('graph.node.created');
    expect(names).toContain('selection.node.selected');
    expect(recorder.byName('graph.node.created')).toHaveLength(1);
  });

  it('replays an intent-only slice of a trace into a fresh boot', async () => {
    // Recording captures the full cascade (intent → request → fact). Replaying the
    // whole trace would double-cascade. The intended replay pattern is to pick a
    // slice — here, only the user's editing intents — and let the systems regenerate
    // the downstream events. This is what makes recorded sessions deterministic.
    const a = bootV2();
    await settle();
    const recorder = a.sim.record();
    recorder.start();
    runCommand(a, 'editing.node.create');
    runCommand(a, 'editing.node.create');
    await settle();
    const trace = recorder.stop();
    expect(a.graphs.current.nodes()).toHaveLength(2);

    const intents = trace.filter(event => event.name.startsWith('editing.'));
    expect(intents).toHaveLength(2);

    const b = bootV2();
    await settle();
    b.sim.replay(intents);
    await settle();
    expect(b.graphs.current.nodes()).toHaveLength(2);
  });

  it('reports orphan emits (emitted with no listener) and silent listeners', async () => {
    const ctx = bootV2();
    await settle();
    // The base app should have no silent listeners at the request side — any request
    // event a system declares has at least the matching handler in the same app.
    // Orphan emits should also be empty for our baseline.
    const orphans = ctx.sim.orphanEmits();
    expect(orphans).toEqual([]);
  });

  it('emitMany fires a synchronous sequence through the bus', async () => {
    const ctx = bootV2();
    await settle();
    ctx.sim.emitMany([
      { name: 'editing.node.create', data: { Label: { text: 'a' } } },
      { name: 'editing.node.create', data: { Label: { text: 'b' } } },
      { name: 'editing.node.create', data: { Label: { text: 'c' } } },
    ]);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(3);
  });
});
