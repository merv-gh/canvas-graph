import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';

const ghost = () => document.querySelector<HTMLElement>('.ghost-node');
const click = (el: HTMLElement) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

/** The ghost is a pure presentation overlay: it previews where the active
 *  layout mode would place the selected node's next item, and clicking it
 *  creates a real, connected node there. Selection then moves to the new
 *  node, so the ghost re-anchors and clicks chain a flow. */
describe('ghost node', () => {
  it('appears only while exactly one node is selected', async () => {
    const ctx = bootApp();
    await settle();
    expect(ghost()).toBeNull();

    ctx.bus.emit('graph.node.create', { Label: { text: 'A' } });
    await settle();
    const a = ctx.graphs.current.nodes()[0];
    // Creation auto-selects the new node (features.ts) — the ghost shows.
    expect(ghost()).not.toBeNull();
    expect(ghost()!.getAttribute('aria-label')).toBe('Add connected below');

    ctx.bus.emit('graph.node.create', { Label: { text: 'B' } });
    await settle();
    const b = ctx.graphs.current.nodes()[1];
    ctx.bus.emit('selection.choose', { refs: [{ kind: 'node', id: a.id }, { kind: 'node', id: b.id }], mode: 'replace' });
    await settle();
    expect(ghost()).toBeNull();

    ctx.bus.emit('selection.node.select', { id: a.id });
    await settle();
    expect(ghost()).not.toBeNull();

    ctx.bus.emit('selection.item.clear');
    await settle();
    expect(ghost()).toBeNull();
  });

  it('click creates a connected node at the previewed spot and chains', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.node.create', { Label: { text: 'Root' } });
    await settle();
    const root = ctx.graphs.current.nodes()[0];
    expect(ghost()).not.toBeNull();
    const preview = {
      x: Number(ghost()!.dataset.ghostX),
      y: Number(ghost()!.dataset.ghostY),
    };
    const camera = ctx.contexts.view.get();

    // The ghost sits where layout.creation points: default mode is tree, so
    // the next node lands directly below the selected one.
    click(ghost()!);
    await settle();

    const nodes = ctx.graphs.current.nodes();
    expect(nodes).toHaveLength(2);
    const child = nodes.find(node => node.id !== root.id)!;
    expect(child.Position).toEqual(preview);
    expect(child.Position!.y).toBeGreaterThan(root.Position!.y);
    expect(child.Position!.x).toBe(root.Position!.x);
    expect(ctx.contexts.view.get()).toEqual(camera);

    const edges = ctx.graphs.current.edges();
    expect(edges).toHaveLength(1);
    expect([edges[0].From, edges[0].To]).toEqual([root.id, child.id]);

    // Selection moved to the child, so the ghost re-anchored — click again.
    expect(ctx.selection.selected()?.id).toBe(child.id);
    expect(ghost()).not.toBeNull();
    click(ghost()!);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(3);
    expect(ctx.graphs.current.edges()).toHaveLength(2);
  });

  it('follows the active layout mode', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('layout.fit', { kind: 'horizontal' });
    ctx.bus.emit('graph.node.create', { Label: { text: 'Root' } });
    await settle();
    const root = ctx.graphs.current.nodes()[0];

    click(ghost()!);
    await settle();
    const child = ctx.graphs.current.nodes().find(node => node.id !== root.id)!;
    // Horizontal mode: the next node lands to the right, same row.
    expect(child.Position!.x).toBeGreaterThan(root.Position!.x);
    expect(child.Position!.y).toBe(root.Position!.y);
  });
});
