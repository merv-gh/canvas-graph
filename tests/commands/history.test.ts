import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

const waitForHistory = async () => {
  await new Promise(resolve => setTimeout(resolve, 150));
  await settle();
};

describe('document history', () => {
  it('undoes and redoes a graph edit', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();
    runCommand(ctx, 'editing.node.create');
    await waitForHistory();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);

    expect(runCommand(ctx, 'history.undo')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(0);

    expect(runCommand(ctx, 'history.redo')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
  });

  it('keeps a replacement and its synchronous layout in one undo step', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false });
    await settle();
    runCommand(ctx, 'editing.node.create');
    await waitForHistory();

    ctx.bus.emit('graph.import.snapshot', {
      nodes: [
        { id: 'import-a', Label: { text: 'A' }, Position: { x: 0, y: 0 }, Size: { w: 150, h: 64 } },
        { id: 'import-b', Label: { text: 'B' }, Position: { x: 0, y: 0 }, Size: { w: 150, h: 64 } },
      ],
      edges: [],
    });
    ctx.bus.emit('layout.apply.tidy');
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);

    expect(runCommand(ctx, 'history.undo')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);

    expect(runCommand(ctx, 'history.redo')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
  });

  it('restores container structure with the graph', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();
    ctx.bus.emit('editing.container.create', { Label: { text: 'Boundary' } });
    await waitForHistory();
    ctx.bus.emit('item.update', {
      ref: { kind: 'container', id: 'c1' },
      patch: { Size: { w: 720, h: 420 }, AutoFit: false },
    });
    await waitForHistory();
    expect(ctx.graphs.current.itemsOfKind<any>('container')[0].Size.w).toBe(720);

    expect(runCommand(ctx, 'history.undo')).toBe(true);
    await settle();
    expect(ctx.graphs.current.itemsOfKind<any>('container')[0].Size.w).toBe(320);

    expect(runCommand(ctx, 'history.redo')).toBe(true);
    await settle();
    expect(ctx.graphs.current.itemsOfKind<any>('container')[0].Size.w).toBe(720);
  });
});
