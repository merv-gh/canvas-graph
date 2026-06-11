import { describe, expect, it } from 'vitest';
import { bootV2, settle } from '../v2-testkit';

const trace = [
  { name: "editing.node.create", data: {"Label":{"text":"Node 1"}}, at: 0 },
  { name: "selection.item.select", data: {"kind":"node","id":"e1"}, at: 0 },
  { name: "editing.node.create", data: {"Label":{"text":"Node 2"},"relativeTo":"e1","connectFrom":"e1"}, at: 0 },
  { name: "selection.item.select", data: {"kind":"node","id":"e2"}, at: 0 },
  { name: "view.fit.item", data: {"kind":"node","id":"e2"}, at: 0 },
  { name: "debug.record.stop", data: undefined, at: 0 },
];

describe('recorded case', () => {
  it('replays and asserts', async () => {
    const ctx = bootV2();
    await settle();

    ctx.sim.replay(trace);
    await settle();

    expect(ctx.graphs.current.nodes()).toHaveLength(2);
    expect(ctx.graphs.current.nodes()[0]?.Label.text).toBe("Node 1");
  });
});
