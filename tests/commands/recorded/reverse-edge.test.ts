import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from '../testkit';

describe("Reverse Edge Direction", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootApp();
    await settle();
    ctx.sim.replay([{ name: "graph.node.create", data: {"id":"e1"}, at: 0 }]);
    await settle();
    ctx.sim.replay([{ name: "graph.node.create", data: {"id":"e2"}, at: 0 }]);
    await settle();
    ctx.sim.replay([{ name: "graph.edge.create", data: {"From":"e1","To":"e2"}, at: 0 }]);
    await settle();
    ctx.sim.replay([{ name: "selection.item.select", data: {"kind":"edge","id":"r1"}, at: 0 }]);
    await settle();
    expect(runCommand(ctx, "graph.edge.reverse"), "command graph.edge.reverse should run").toBe(true);
    await settle();
    expect(ctx.debug!.snapshot().graph.edges[0].From).toEqual("e2");
  });
});
