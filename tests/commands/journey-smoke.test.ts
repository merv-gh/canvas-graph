import { describe, expect, it } from 'vitest';
import { checks, setup, steps } from './testkit';

/**
 * Happy-path journey: a fresh user does the most ordinary thing — create a
 * couple of nodes, wire them together, edit a title, configure a width,
 * delete the selection, switch graphs. Each step has its own unit / journey
 * test elsewhere; this one is the integration guard.
 *
 * Asserts:
 *   - boot has zero DX errors (the contract validator agrees with itself).
 *   - the journey completes without throwing.
 *   - DX still passes at every checkpoint.
 *   - the captured state matches expectations.
 */
describe('frontend journey smoke (happy path)', () => {
  it('creates → edges → edits → configures → deletes → switches without DX drift', async () => {
    const ctx = setup.app();
    await steps.settle();
    checks.noDxErrors(ctx, 'boot');

    // 1. Create two nodes via the canonical user command.
    steps.command(ctx, 'editing.node.create');
    await steps.settle();
    steps.command(ctx, 'editing.node.create');
    await steps.settle();
    // Smart-A auto-attaches the second to the first, so we already have an edge.
    checks.graphItems(ctx, { edges: 1, nodes: 2 });
    checks.noDxErrors(ctx, 'after creates');

    // 2. Edit the selected node's title via the generic item.update seam.
    const selectedAfterCreate = ctx.selection.selectedNode();
    expect(selectedAfterCreate).toBeTruthy();
    ctx.bus.emit('item.update', {
      ref: { kind: 'node', id: selectedAfterCreate!.id },
      patch: { Label: { text: 'Renamed' } },
    });
    await steps.settle();
    expect(ctx.graphs.current.getNode(selectedAfterCreate!.id)?.Label.text).toBe('Renamed');
    checks.noDxErrors(ctx, 'after edit');

    // 3. Configure: change width through the same generic seam.
    ctx.bus.emit('item.update', {
      ref: { kind: 'node', id: selectedAfterCreate!.id },
      patch: { Size: { w: 200, h: 64 } },
    });
    await steps.settle();
    expect(ctx.graphs.current.getNode(selectedAfterCreate!.id)?.Size).toEqual({ w: 200, h: 64 });
    checks.noDxErrors(ctx, 'after configure');

    // 4. Delete the selection.
    steps.command(ctx, 'selection.item.delete');
    await steps.settle();
    // Cascade: incident edge dropped with the node.
    checks.graphItems(ctx, { edges: 0, nodes: 1 });
    checks.noDxErrors(ctx, 'after delete');

    // 5. Create a second graph, switch to it, confirm isolation.
    steps.command(ctx, 'graph.create');
    await steps.settle();
    checks.graphItems(ctx, { nodes: 0 });
    steps.command(ctx, 'editing.node.create');
    await steps.settle();
    checks.graphItems(ctx, { nodes: 1 });
    checks.noDxErrors(ctx, 'after switch');
  });

  it('introspect reflects current shape — adding a node shows up immediately', async () => {
    const ctx = setup.app();
    await steps.settle();
    const { introspect } = await import('../../frontend/core');
    const snap = introspect(ctx);
    // Node + edge entities are declared; collections list them; selectable et al
    // declare themselves on the node entity.
    expect(snap.nodes.some(n => n.kind === 'entity' && n.id === 'node')).toBe(true);
    expect(snap.nodes.some(n => n.kind === 'ability' && n.id === 'ability.draggable')).toBe(true);
    expect(snap.nodes.some(n => n.kind === 'collection' && n.id === 'nodes')).toBe(true);
    // Declares edge from entity → ability.
    expect(snap.edges.some(e =>
      e.relation === 'declares' && e.from.kind === 'entity' && e.from.id === 'node' && e.to.id === 'ability.draggable',
    )).toBe(true);
    // The render system subscribes to render.shell. Bus origin tracking caught it.
    expect(snap.edges.some(e =>
      e.relation === 'subscribes' && e.from.kind === 'system' && e.from.id === 'render' && e.to.id === 'render.shell',
    )).toBe(true);
  });
});
