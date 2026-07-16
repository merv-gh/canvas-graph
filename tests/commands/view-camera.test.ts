import { describe, expect, it } from 'vitest';
import { nodeRect } from '../../frontend/core';
import { Places } from '../../frontend/types';
import { bootApp, settle } from './testkit';

const containsRect = (
  outer: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
) => inner.x >= outer.x
  && inner.y >= outer.y
  && inner.x + inner.w <= outer.x + outer.w
  && inner.y + inner.h <= outer.y + outer.h;

const waitCamera = async () => {
  await new Promise(resolve => setTimeout(resolve, 220));
  await settle();
};

describe('frontend gentle item camera', () => {
  it('animates a pan-only reveal when the item fits at the current zoom', async () => {
    const ctx = bootApp();
    const node = ctx.graphs.current.createNode({
      Label: { text: 'far' },
      Position: { x: 1050, y: 300 },
    });
    const changes: unknown[] = [];
    ctx.bus.on('view.changed', view => changes.push(view));

    ctx.bus.emit('view.fit.item', { kind: 'node', id: node.id });
    await waitCamera();

    expect(changes.length).toBeGreaterThan(1);
    expect(ctx.contexts.view.get().scale).toBe(1);
    expect(ctx.contexts.view.get().x).toBeGreaterThan(0);
    expect(containsRect(ctx.contexts.view.visibleRect(Places.Stage)!, nodeRect(node))).toBe(true);
  });

  it('zooms out a little when the item fits the stage but not the comfort zone', async () => {
    const ctx = bootApp();
    const node = ctx.graphs.current.createNode({
      Label: { text: 'wide' },
      Position: { x: 450, y: 300 },
      Size: { w: 600, h: 64 },
    });

    ctx.bus.emit('view.fit.item', { kind: 'node', id: node.id });
    await waitCamera();

    expect(ctx.contexts.view.get().scale).toBeLessThan(1);
    expect(ctx.contexts.view.get().scale).toBeGreaterThan(0.85);
  });

  it('keeps an oversized item readable at 80% and aligns its start to the top', async () => {
    const ctx = bootApp();
    const node = ctx.graphs.current.createNode({
      Label: { text: 'huge' },
      Position: { x: 450, y: 300 },
      Size: { w: 2400, h: 64 },
    });

    ctx.bus.emit('view.fit.item', { kind: 'node', id: node.id });
    await waitCamera();

    const view = ctx.contexts.view.get();
    expect(view.scale).toBeCloseTo(0.8, 5);
    expect(containsRect(ctx.contexts.view.visibleRect(Places.Stage)!, nodeRect(node))).toBe(false);
    const nodeTop = (node.Position!.y - node.Size.h / 2 - view.y) * view.scale;
    expect(nodeTop).toBeCloseTo(72, 0);
  });

  it('fits a tall document no lower than 80% and lets its lower end continue off-screen', async () => {
    const ctx = bootApp({ autoLayout: false });
    const first = ctx.graphs.current.createNode({ Label: { text: 'first' }, Position: { x: 450, y: 120 } });
    const last = ctx.graphs.current.createNode({ Label: { text: 'last' }, Position: { x: 450, y: 2120 } });

    ctx.bus.emit('view.fit.all');
    const view = ctx.contexts.view.get();

    expect(view.scale).toBeCloseTo(0.8, 5);
    const firstTop = (first.Position!.y - first.Size.h / 2 - view.y) * view.scale;
    const lastBottom = (last.Position!.y + last.Size.h / 2 - view.y) * view.scale;
    expect(firstTop).toBeCloseTo(72, 0);
    expect(lastBottom).toBeGreaterThan(600);
  });
});
