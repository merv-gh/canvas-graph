import { describe, expect, it } from 'vitest';
import { itemFoldId, nodeRect } from '../../v2/core';
import { Places } from '../../v2/types';
import { bootV2, commandButton, field, runCommand, settle } from './v2-testkit';

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

describe('v2 node commands', () => {
  it('creates, selects, focuses, renders, collapses, nudges, and configures a node', async () => {
    const ctx = bootV2();

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
    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(true);
    expect(nodeFold()).toBe(true);

    const before = { ...node.Position! };
    expect(runCommand(ctx, 'item.nudge.right')).toBe(true);
    expect(node.Position).toEqual({ x: before.x + 24, y: before.y });

    expect(ctx.contexts.commands.get('item.properties.open')?.input).toMatchObject({ key: '.' });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('.modal-head')?.textContent).toContain('Node Properties');
    const title = document.querySelector<HTMLInputElement>('.properties [data-field="title"]')!;
    title.value = 'Configured';
    expect(runCommand(ctx, 'properties.item.input', { target: title })).toBe(true);
    expect(node.Label.text).toBe('Configured');

    const width = document.querySelector<HTMLInputElement>('.properties [data-field="width"]')!;
    width.value = '222';
    expect(runCommand(ctx, 'properties.item.input', { target: width })).toBe(true);
    expect(node.Size.w).toBe(222);

    // No 'collapsed' property anymore — toggling the fold again expands it.
    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(true);
    expect(nodeFold()).toBe(false);
  });

  it('routes keyboard and click input through the command registry', async () => {
    const ctx = bootV2();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);

    commandButton('editing.node.create')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
  });

  it('fits to a newly created node when attached placement lands offscreen', async () => {
    const ctx = bootV2();
    const anchor = ctx.graphs.current.createNode({
      Label: { text: 'edge anchor' },
      Position: { x: 840, y: 300 },
    });
    ctx.bus.emit('selection.node.select', { id: anchor.id });
    const before = ctx.contexts.view.get();

    expect(runCommand(ctx, 'editing.node.create')).toBe(true);
    await waitCamera();

    const created = ctx.graphs.current.nodes().find(node => node.id !== anchor.id)!;
    expect(created.Position!.x).toBeGreaterThan(900);
    expect(ctx.contexts.view.get()).not.toEqual(before);
    expect(ctx.contexts.view.get().scale).toBe(1);
    expect(containsRect(ctx.contexts.view.visibleRect(Places.Stage)!, nodeRect(created))).toBe(true);
  });

  it('moves DOM focus when selecting nodes by pointer or Tab', async () => {
    const ctx = bootV2();
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
    const ctx = bootV2();
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

  it('drags only from the explicit drag handle (now in ephemeral node-toolbar)', async () => {
    const ctx = bootV2();
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
    const ctx = bootV2({ 'ability.collapsible': false });

    expect(ctx.contexts.commands.get('item.collapse.toggle')).toBeUndefined();
    expect(ctx.model.entity('node')?.abilities.map(ability => ability.id)).not.toContain('collapsible');
  });

  it('creates, switches, deletes graphs, and cascades node deletion to edges', async () => {
    const ctx = bootV2();
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
    const ctx = bootV2();
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
