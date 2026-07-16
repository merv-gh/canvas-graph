import { describe, expect, it } from 'vitest';
import { itemFoldId, nodeRect } from '../../frontend/core';
import { Places } from '../../frontend/types';
import { bootApp, commandButton, field, runCommand, settle } from './testkit';

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

describe('frontend node commands', () => {
  it('offers fold only for described nodes and clears stale fold state with the description', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const ref = { kind: 'node' as const, id: node.id };
    const foldId = itemFoldId(ref, ctx.graphs.current.id);

    expect(document.querySelector('.item-toolbar [data-command="item.collapse.toggle"]')).toBeNull();
    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(false);

    ctx.bus.emit('item.update', { ref, patch: { Description: 'Foldable **detail**.' } });
    await settle();
    expect(document.querySelector('.item-toolbar [data-command="item.collapse.toggle"]')).not.toBeNull();
    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(true);
    await settle();
    const element = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)!;
    expect(element.classList.contains('collapsed')).toBe(true);
    expect(element.getAttribute('aria-expanded')).toBe('false');
    expect(Number.parseFloat(element.style.height)).toBeLessThan(node.Size.h);

    ctx.bus.emit('item.update', { ref, patch: { Description: '' } });
    await settle();
    expect(ctx.contexts.fold.folded(foldId)).toBe(false);
    expect(document.querySelector(`.node[data-item-id="${node.id}"]`)?.classList.contains('collapsed')).toBe(false);
    expect(document.querySelector('.item-toolbar [data-command="item.collapse.toggle"]')).toBeNull();
  });

  it('creates, selects, focuses, renders, collapses, nudges, and configures a node', async () => {
    const ctx = bootApp();

    expect(runCommand(ctx, 'editing.node.create')).toBe(true);
    await settle();

    const node = ctx.graphs.current.nodes()[0];
    expect(node.Label.text).toBe('Node 1');
	    expect(ctx.selection.selectedNode()?.id).toBe(node.id);
	    expect(ctx.selection.focusedNode()?.id).toBe(node.id);
	    expect(document.querySelector('.node-title')?.textContent).toBe('Node 1');
	    expect((document.activeElement as HTMLElement | null)?.dataset.itemId).toBe(node.id);

    // Collapse is fold state now (presentation), not node data.
    const nodeFold = () => ctx.contexts.fold.folded(itemFoldId({ kind: 'node', id: node.id }, ctx.graphs.current.id));
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: node.id }, patch: { Description: 'Details to fold.' } });
    await settle();
    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(true);
    expect(nodeFold()).toBe(true);

    const before = { ...node.Position! };
    expect(runCommand(ctx, 'item.nudge.right')).toBe(true);
    expect(node.Position).toEqual({ x: before.x + 24, y: before.y });

    expect(ctx.contexts.commands.get('item.context.open')?.input).toMatchObject({ key: '.' });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('.context-actions')).not.toBeNull();
    const title = document.querySelector<HTMLInputElement>('[data-item-modal-title]')!;
    title.focus();
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(document.activeElement).toBe(title);
    title.value = 'Configured';
    expect(runCommand(ctx, 'properties.title.input', { target: title })).toBe(true);
    expect(node.Label.text).toBe('Configured');
    expect(document.querySelector('.properties [data-field="width"]')).toBeNull();
    expect(document.querySelector('.properties [data-field="height"]')).toBeNull();

    // No 'collapsed' property anymore — toggling the fold again expands it.
    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(true);
    expect(nodeFold()).toBe(false);
  });

  it('routes keyboard and click input through the command registry', async () => {
    const ctx = bootApp();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);

    commandButton('editing.node.create')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });

  it('centres the graph after attached placement lands offscreen', async () => {
    const ctx = bootApp();
    const anchor = ctx.graphs.current.createNode({
      Label: { text: 'edge anchor' },
      Position: { x: 840, y: 300 },
    });
    ctx.bus.emit('selection.node.select', { id: anchor.id });
    const before = ctx.contexts.view.get();

    expect(runCommand(ctx, 'editing.node.create')).toBe(true);
    await waitCamera();

    const created = ctx.graphs.current.nodes().find(node => node.id !== anchor.id)!;
    expect(created.Position!.x).toBe(anchor.Position!.x);
    expect(created.Position!.y).toBeGreaterThan(anchor.Position!.y);
    expect(ctx.contexts.view.get()).not.toEqual(before);
    expect(ctx.contexts.view.get().scale).toBe(1.25);
    const visible = ctx.contexts.view.visibleRect(Places.Stage)!;
    const bounds = ctx.graphs.current.nodes().map(nodeRect);
    const centre = {
      x: (Math.min(...bounds.map(rect => rect.x)) + Math.max(...bounds.map(rect => rect.x + rect.w))) / 2,
      y: (Math.min(...bounds.map(rect => rect.y)) + Math.max(...bounds.map(rect => rect.y + rect.h))) / 2,
    };
    expect(visible.x + visible.w / 2).toBeCloseTo(centre.x);
    expect(visible.y + visible.h / 2).toBeCloseTo(centre.y);
    expect(containsRect(visible, nodeRect(created))).toBe(true);
  });

  it('moves DOM focus when selecting nodes by pointer or Tab', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const [first, second] = ctx.graphs.current.nodes();

    expect((document.activeElement as HTMLElement | null)?.dataset.itemId).toBe(second.id);

    document.querySelector(`[data-item-kind="node"][data-item-id="${first.id}"]`)!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.selectedNode()?.id).toBe(first.id);
    expect(ctx.selection.focusedNode()?.id).toBe(first.id);
    expect((document.activeElement as HTMLElement | null)?.dataset.itemId).toBe(first.id);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.selectedNode()?.id).toBe(second.id);
    expect(ctx.selection.focusedNode()?.id).toBe(second.id);
    expect((document.activeElement as HTMLElement | null)?.dataset.itemId).toBe(second.id);

    expect(runCommand(ctx, 'selection.node.clear')).toBe(true);
    await settle();
    expect(ctx.selection.selected()).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.dataset.itemId).toBeUndefined();
  });

  it('edits title from the rendered node and restores empty commits', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const title = document.querySelector<HTMLElement>('.node-title')!;

    title.textContent = 'Inline';
    expect(runCommand(ctx, 'item.title.commit.enter', { target: title })).toBe(true);
    expect(node.Label.text).toBe('Inline');

    title.textContent = '';
    expect(runCommand(ctx, 'item.title.commit.focusout', { target: title })).toBe(true);
    expect(title.textContent).toBe('Inline');
  });

  it('returns keyboard focus to the node after Enter finishes title editing', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];

    expect(runCommand(ctx, 'item.title.edit')).toBe(true);
    await settle();
    const title = document.querySelector<HTMLElement>('.node-title')!;
    expect(document.activeElement).toBe(title);
    title.textContent = 'Keyboard title';

    expect(runCommand(ctx, 'item.title.commit.enter', { target: title })).toBe(true);
    await settle();
    expect(node.Label.text).toBe('Keyboard title');
    expect(document.activeElement).not.toBe(title);
    expect((document.activeElement as HTMLElement | null)?.dataset.itemId).toBe(node.id);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
  });

  it('blurs the inspector title input when Enter finishes editing', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(runCommand(ctx, 'item.properties.open')).toBe(true);
    await settle();
    const title = document.querySelector<HTMLInputElement>('[data-item-modal-title]')!;
    title.focus();
    title.value = 'Inspector title';
    expect(runCommand(ctx, 'properties.title.input', { target: title })).toBe(true);
    expect(runCommand(ctx, 'properties.title.finish.enter', { target: title })).toBe(true);
    await settle();

    expect(ctx.graphs.current.nodes()[0].Label.text).toBe('Inspector title');
    expect(document.activeElement).not.toBe(title);
  });

  it('preserves existing positions when nodes are added or deleted', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const first = ctx.graphs.current.nodes()[0];
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: first.id }, patch: { Position: { x: 420, y: 260 } } });
    await settle();
    const stablePosition = { ...first.Position! };

    runCommand(ctx, 'editing.node.create');
    await settle();
    const second = ctx.graphs.current.nodes().find(node => node.id !== first.id)!;
    expect(first.Position).toEqual(stablePosition);

    const cameraBeforeDelete = ctx.contexts.view.get();
    ctx.bus.emit('graph.node.delete', { id: second.id });
    await settle();
    expect(first.Position).toEqual(stablePosition);
    expect(ctx.contexts.view.get()).toEqual(cameraBeforeDelete);
  });

  it('drags only from the explicit drag handle (now in ephemeral node-toolbar)', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const before = { ...node.Position! };
    // Smart A leaves the new node selected, so the floating toolbar (which
    // owns the drag handle now that the in-node header is gone) is mounted.
    const toolbar = document.querySelector<HTMLElement>('.node-toolbar')!;
    expect(toolbar).not.toBeNull();
    const handle = toolbar.querySelector<HTMLElement>('.node-drag-handle')!;
    expect(handle.hasAttribute('data-drag-handle')).toBe(true);
    expect(document.querySelector('.node .node-header')).toBeNull();

    runCommand(ctx, 'drag.item.start', { event: new PointerEvent('pointerdown', { clientX: 10, clientY: 10 }), target: handle });
    runCommand(ctx, 'drag.item.move', { event: new PointerEvent('pointermove', { clientX: 70, clientY: 30 }), target: document.body });
    runCommand(ctx, 'drag.item.end');

    expect(node.Position!.x).toBeGreaterThan(before.x);
    expect(node.Position!.y).toBeGreaterThan(before.y);
  });

  it('can disable an ability and hide its commands from the model', () => {
    const ctx = bootApp({ 'ability.collapsible': false });

    expect(ctx.contexts.commands.get('item.collapse.toggle')).toBeUndefined();
    expect(ctx.model.entity('node')?.abilities.map(ability => ability.id)).not.toContain('collapsible');
  });

  it('creates, switches, deletes graphs, and cascades node deletion to edges', async () => {
    const ctx = bootApp();
    expect(runCommand(ctx, 'graph.create')).toBe(true);
    expect(ctx.graphs.current.id).toBe('g2');

    expect(runCommand(ctx, 'graph.switch.next')).toBe(true);
    expect(ctx.graphs.current.id).toBe('g1');

    const first = ctx.graphs.current;
    expect(runCommand(ctx, 'graph.delete')).toBe(true);
    expect(ctx.graphs.current).not.toBe(first);

    // Direct create — smart-A would auto-attach the second node and create an
    // extra edge (Principle 17). This test wants two unconnected nodes plus
    // exactly one explicit edge.
    const a = ctx.graphs.current.createNode({ Label: { text: 'a' } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'b' } });
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    expect(ctx.graphs.current.edges()).toHaveLength(1);

    ctx.bus.emit('selection.node.select', { id: a.id });
    expect(runCommand(ctx, 'graph.node.delete')).toBe(true);
    expect(ctx.graphs.current.getNode(a.id)).toBeUndefined();
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });

  it('deletes a selected node with the general X shortcut', async () => {
    const ctx = bootApp();
    const a = ctx.graphs.current.createNode({ Label: { text: 'a' } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'b' } });
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    ctx.bus.emit('selection.node.select', { id: a.id });

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.graphs.current.getNode(a.id)).toBeUndefined();
    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(ctx.selection.selected()).toBeNull();
  });
});
