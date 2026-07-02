import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

/** UX overhaul: select.all alias, framed presentation lens, marquee wiring.
 *  Locks the observable snapshot fields the manifest (frontend/ux.md) promised. */

const buildStar = async (ctx: ReturnType<typeof bootApp>) => {
  // Hub node + 3 spokes, all edges out of the hub.
  const hub = ctx.graphs.current.createNode({ Label: { text: 'Hub' }, Position: { x: 0, y: 0 } });
  const spokes = ['A', 'B', 'C'].map((t, i) =>
    ctx.graphs.current.createNode({ Label: { text: t }, Position: { x: (i - 1) * 200, y: 200 } }),
  );
  spokes.forEach(s => ctx.graphs.current.createEdge({ From: hub.id, To: s.id, Label: { text: `to ${s.id}` } }));
  ctx.bus.forward('graph.node.created', { id: hub.id });
  await settle();
  return { hub, spokes };
};

describe('UX: select.all', () => {
  it('is a palette-visible alias that chooses every node', async () => {
    const ctx = bootApp();
    await buildStar(ctx);
    const cmd = ctx.contexts.commands.get('select.all');
    expect(cmd).toBeTruthy();
    expect(cmd?.hidden).toBeFalsy();
    runCommand(ctx, 'select.all');
    await settle();
    // choose.all selects every item (nodes + edges) — assert every node is in.
    const chosen = new Set(ctx.selection.selectedAll().map(r => `${r.kind}:${r.id}`));
    expect(ctx.graphs.current.nodes().every(n => chosen.has(`node:${n.id}`))).toBe(true);
  });
});

describe('UX: framed presentation mode', () => {
  it('enters the lens focused on the selected node with directional neighbours', async () => {
    const ctx = bootApp();
    const { hub } = await buildStar(ctx);
    ctx.bus.forward('selection.item.select', { kind: 'node', id: hub.id });
    await settle();

    runCommand(ctx, 'present.toggle');
    await settle();
    const s = ctx.debug.snapshot();
    expect(s.ui.present.active).toBe(true);
    expect(s.ui.present.focusId).toBe(hub.id);
    expect(s.ui.present.mode).toBe('nodes');           // edge labels OFF by default
    expect(s.ui.present.neighbours).toBe(3);           // all three spokes shown
  });

  it('toggles between node text and edge labels', async () => {
    const ctx = bootApp();
    const { hub } = await buildStar(ctx);
    ctx.bus.forward('selection.item.select', { kind: 'node', id: hub.id });
    await settle();
    runCommand(ctx, 'present.toggle');
    await settle();

    ctx.bus.forward('present.mode.toggle', undefined);
    await settle();
    expect(ctx.debug.snapshot().ui.present.mode).toBe('edges');
  });

  it('renders a real sub-graph (nodes + edges) into the modal', async () => {
    const ctx = bootApp();
    const { hub } = await buildStar(ctx);
    ctx.bus.forward('selection.item.select', { kind: 'node', id: hub.id });
    await settle();
    runCommand(ctx, 'present.toggle');
    await settle();
    // Focus + up-to-3 neighbours drawn with the real node/edge renderers.
    expect(document.querySelectorAll('.present-substage .node').length).toBe(4);
    expect(document.querySelectorAll('.present-substage .edge-line').length).toBeGreaterThan(0);
    expect(ctx.debug.snapshot().ui.modal.open).toBe(true);
  });

  it('navigating the lens never moves the main canvas', async () => {
    const ctx = bootApp();
    const { hub, spokes } = await buildStar(ctx);
    ctx.bus.forward('selection.item.select', { kind: 'node', id: hub.id });
    await settle();
    runCommand(ctx, 'present.toggle');
    await settle();
    // The contract: hopping focus in the lens issues no camera command at all.
    let cameraMoved = false;
    const off = ctx.bus.on('view.fit.item', () => { cameraMoved = true; });
    ctx.bus.forward('present.move', { dir: 'down' }); // B sits below the hub
    await settle();
    off();
    expect(cameraMoved).toBe(false);
    expect(ctx.debug.snapshot().ui.present.focusId).toBe(spokes[1].id);
  });

  it('"Open in canvas" selects the focused node and exits', async () => {
    const ctx = bootApp();
    const { hub } = await buildStar(ctx);
    ctx.bus.forward('selection.item.select', { kind: 'node', id: hub.id });
    await settle();
    runCommand(ctx, 'present.toggle');
    await settle();
    ctx.bus.forward('present.jump', undefined);
    await settle();
    expect(ctx.debug.snapshot().ui.present.active).toBe(false);
    expect(ctx.selection.selected()).toMatchObject({ kind: 'node', id: hub.id });
  });

  it('exits back to the canvas', async () => {
    const ctx = bootApp();
    const { hub } = await buildStar(ctx);
    ctx.bus.forward('selection.item.select', { kind: 'node', id: hub.id });
    await settle();
    runCommand(ctx, 'present.toggle');
    await settle();
    runCommand(ctx, 'present.toggle');
    await settle();
    expect(ctx.debug.snapshot().ui.present.active).toBe(false);
  });
});

describe('UX: marquee selection wiring', () => {
  it('exposes box-select commands and no band at rest', async () => {
    const ctx = bootApp();
    await buildStar(ctx);
    expect(ctx.contexts.commands.get('select.box.start')).toBeTruthy();
    expect(ctx.debug.snapshot().ui.stage.marqueeVisible).toBe(false);
  });
});
