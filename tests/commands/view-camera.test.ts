import { describe, expect, it } from 'vitest';
import { nodeRect } from '../../v2/core';
import { Places } from '../../v2/types';
import { bootV2, settle } from './v2-testkit';

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

describe('v2 gentle item camera', () => {
  it('animates a pan-only reveal when the item fits at the current zoom', async () => {
    const ctx = bootV2();
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
    const ctx = bootV2();
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

  it('zooms out more when panning cannot create enough room', async () => {
    const ctx = bootV2();
    const node = ctx.graphs.current.createNode({
      Label: { text: 'huge' },
      Position: { x: 450, y: 300 },
      Size: { w: 2400, h: 64 },
    });

    ctx.bus.emit('view.fit.item', { kind: 'node', id: node.id });
    await waitCamera();

    expect(ctx.contexts.view.get().scale).toBeLessThan(0.5);
    expect(containsRect(ctx.contexts.view.visibleRect(Places.Stage)!, nodeRect(node))).toBe(true);
  });
});
