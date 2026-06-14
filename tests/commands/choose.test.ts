import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import { snapshot } from '../../frontend/core';
import type { ItemRef } from '../../frontend/types';

/** Multi-item "choose → act" is the robustness probe for the whole stack:
 *  decorations (the set is painted), selection (a set with a primary),
 *  deletion (cleanup of N), redraw (after a set change), and composition
 *  (group reuses container + add-child). Every bulk action fans out into the
 *  SAME per-item events single-select uses — so if these pass, the seams hold. */

const nodeIds = (ctx: ReturnType<typeof bootApp>) => ctx.graphs.current.nodes().map(n => n.id);
const nodeRefs = (ctx: ReturnType<typeof bootApp>): ItemRef[] => nodeIds(ctx).map(id => ({ kind: 'node', id }));
const nodeEl = (id: string) => document.querySelector(`.node[data-item-kind="node"][data-item-id="${id}"]`);
const containers = (ctx: ReturnType<typeof bootApp>) =>
  ctx.graphs.current.itemsOfKind<{ id: string; Children: ItemRef[] }>('container');

describe('frontend choose — multi-item set + bulk actions', () => {
  it('choose.all selects every item and paints the set (decorations)', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    runCommand(ctx, 'choose.all');
    await settle();

    const total = ctx.graphs.current.nodes().length + ctx.graphs.current.edges().length;
    expect(ctx.selection.selectedAll()).toHaveLength(total);
    expect(snapshot(ctx).selection.count).toBe(total);
    // Every node carries the 'selected' decoration in the DOM — set is visible.
    nodeIds(ctx).forEach(id => expect(nodeEl(id)?.classList.contains('selected')).toBe(true));
  });

  it('Cmd+A aliases choose.all without selecting page text', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();

    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await settle();

    const total = ctx.graphs.current.nodes().length + ctx.graphs.current.edges().length;
    expect(ctx.contexts.commands.get('choose.all.cmd')?.event).toBe('choose.all');
    expect(ctx.selection.selectedAll()).toHaveLength(total);
    expect(document.getSelection()?.toString() ?? '').toBe('');
  });

  it('toggle adds and removes a single item (random access)', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const [a, b] = nodeIds(ctx);
    ctx.bus.emit('selection.item.select', { kind: 'node', id: a });
    await settle();
    expect(ctx.selection.selectedAll()).toHaveLength(1);

    ctx.bus.emit('selection.item.toggle', { kind: 'node', id: b });
    await settle();
    expect(ctx.selection.has({ kind: 'node', id: b })).toBe(true);
    expect(ctx.selection.selectedAll()).toHaveLength(2);

    ctx.bus.emit('selection.item.toggle', { kind: 'node', id: b });
    await settle();
    expect(ctx.selection.has({ kind: 'node', id: b })).toBe(false);
    expect(ctx.selection.selectedAll()).toHaveLength(1);
  });

  it('delete acts on the whole set and cleans up selection + DOM + redraw', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    runCommand(ctx, 'choose.all');
    await settle();

    runCommand(ctx, 'selection.item.delete');
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(0);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(ctx.selection.selectedAll()).toHaveLength(0);
    expect(document.querySelectorAll('.node[data-item-kind="node"]')).toHaveLength(0);
  });

  it('choose.none clears the set; Escape-equivalent', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    runCommand(ctx, 'choose.all');
    await settle();
    expect(ctx.selection.selectedAll().length).toBeGreaterThan(0);
    runCommand(ctx, 'choose.none');
    await settle();
    expect(ctx.selection.selectedAll()).toHaveLength(0);
  });

  it('move (nudge) shifts every chosen node by the same delta', async () => {
    const ctx = bootApp();
    await settle();
    const a = ctx.graphs.current.createNode({ Label: { text: 'a' }, Position: { x: 0, y: 0 } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'b' }, Position: { x: 100, y: 0 } });
    ctx.bus.emit('selection.choose', { refs: [{ kind: 'node', id: a.id }, { kind: 'node', id: b.id }], mode: 'replace' });
    await settle();
    runCommand(ctx, 'item.nudge.right');
    await settle();
    expect(ctx.graphs.current.getNode(a.id)!.Position!.x).toBe(24);
    expect(ctx.graphs.current.getNode(b.id)!.Position!.x).toBe(124);
  });

  it('move does not double-apply to a child whose container is also chosen', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const cid = containers(ctx)[0].id;
    const child = ctx.graphs.current.createNode({ Label: { text: 'child' }, Position: { x: 50, y: 50 } });
    ctx.bus.emit('container.add-child', { containerId: cid, childRef: { kind: 'node', id: child.id } });
    await settle();
    // Choose BOTH the container and its child, then nudge.
    ctx.bus.emit('selection.choose', { refs: [{ kind: 'container', id: cid }, { kind: 'node', id: child.id }], mode: 'replace' });
    await settle();
    runCommand(ctx, 'item.nudge.right');
    await settle();
    // Child moved by exactly one delta (container cascade), not two.
    expect(ctx.graphs.current.getNode(child.id)!.Position!.x).toBe(74);
  });

  it('group folds the chosen items into a new container that nests them', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const ids = nodeIds(ctx);
    ctx.bus.emit('selection.choose', { refs: nodeRefs(ctx), mode: 'replace' });
    await settle();

    runCommand(ctx, 'selection.group');
    await settle();

    expect(containers(ctx)).toHaveLength(1);
    const cid = containers(ctx)[0].id;
    expect(containers(ctx)[0].Children).toHaveLength(ids.length);
    // Visible nesting in the outline + the new container is the selection.
    ids.forEach(id =>
      expect(document.querySelector(`.outline-children .outline-row[data-item-kind="node"][data-item-id="${id}"]`)).not.toBeNull());
    expect(ctx.selection.selected()).toEqual({ kind: 'container', id: cid });
  });

  it('follow grows the set one hop along edges', async () => {
    const ctx = bootApp();
    await settle();
    const a = ctx.graphs.current.createNode({ Label: { text: 'a' } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'b' } });
    const c = ctx.graphs.current.createNode({ Label: { text: 'c' } });
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    ctx.bus.emit('graph.edge.create', { From: b.id, To: c.id });
    await settle();
    ctx.bus.emit('selection.choose', { refs: [{ kind: 'node', id: a.id }], mode: 'replace' });
    await settle();
    runCommand(ctx, 'choose.follow');
    await settle();
    expect(ctx.selection.has({ kind: 'node', id: b.id })).toBe(true);  // a→b is one hop
    expect(ctx.selection.has({ kind: 'node', id: c.id })).toBe(false); // c is two hops away
  });

  it('search chooses every item whose label matches', async () => {
    const ctx = bootApp();
    await settle();
    ctx.graphs.current.createNode({ Label: { text: 'Alpha' } });
    ctx.graphs.current.createNode({ Label: { text: 'Beta' } });
    ctx.graphs.current.createNode({ Label: { text: 'Alpine' } });
    await settle();
    ctx.bus.emit('choose.search', { q: 'alp' });
    await settle();
    expect(ctx.selection.selectedAll()).toHaveLength(2); // Alpha + Alpine
  });

  it('radius grows the set to spatially-adjacent nodes', async () => {
    const ctx = bootApp();
    await settle();
    const a = ctx.graphs.current.createNode({ Label: { text: 'a' }, Position: { x: 0, y: 0 } });
    const near = ctx.graphs.current.createNode({ Label: { text: 'near' }, Position: { x: 120, y: 0 } });
    const far = ctx.graphs.current.createNode({ Label: { text: 'far' }, Position: { x: 1000, y: 0 } });
    ctx.bus.emit('selection.choose', { refs: [{ kind: 'node', id: a.id }], mode: 'replace' });
    await settle();
    runCommand(ctx, 'choose.radius');
    await settle();
    expect(ctx.selection.has({ kind: 'node', id: near.id })).toBe(true);
    expect(ctx.selection.has({ kind: 'node', id: far.id })).toBe(false);
  });

  it('invert flips set membership across all items', async () => {
    const ctx = bootApp();
    await settle();
    const a = ctx.graphs.current.createNode({ Label: { text: 'a' } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'b' } });
    const c = ctx.graphs.current.createNode({ Label: { text: 'c' } });
    ctx.bus.emit('selection.choose', { refs: [{ kind: 'node', id: a.id }], mode: 'replace' });
    await settle();
    runCommand(ctx, 'choose.invert');
    await settle();
    expect(ctx.selection.has({ kind: 'node', id: a.id })).toBe(false);
    expect(ctx.selection.has({ kind: 'node', id: b.id })).toBe(true);
    expect(ctx.selection.has({ kind: 'node', id: c.id })).toBe(true);
  });
});
