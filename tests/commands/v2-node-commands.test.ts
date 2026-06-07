import { describe, expect, it } from 'vitest';
import { bootV2, commandButton, field, runCommand, settle } from './v2-testkit';

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
	    expect((document.activeElement as HTMLElement | null)?.dataset.nodeId).toBe(node.id);

    expect(runCommand(ctx, 'node.collapse.toggle')).toBe(true);
    expect(node.Collapsed).toBe(true);

    const before = { ...node.Position! };
    expect(runCommand(ctx, 'graph.node.nudge.right')).toBe(true);
    expect(node.Position).toEqual({ x: before.x + 24, y: before.y });

    expect(runCommand(ctx, 'item.properties.open')).toBe(true);
    expect(document.querySelector('.modal-head')?.textContent).toContain('Node Properties');
    const title = document.querySelector<HTMLInputElement>('.properties [data-field="title"]')!;
    title.value = 'Configured';
    expect(runCommand(ctx, 'properties.item.input', { target: title })).toBe(true);
    expect(node.Label.text).toBe('Configured');

    const width = document.querySelector<HTMLInputElement>('.properties [data-field="width"]')!;
    width.value = '222';
    expect(runCommand(ctx, 'properties.item.input', { target: width })).toBe(true);
    expect(node.Size.w).toBe(222);

    const collapsed = document.querySelector<HTMLInputElement>('.properties [data-field="collapsed"]')!;
    collapsed.checked = false;
    expect(runCommand(ctx, 'properties.item.toggle', { target: collapsed })).toBe(true);
    expect(node.Collapsed).toBe(false);
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

  it('moves DOM focus when selecting nodes by pointer or Tab', async () => {
    const ctx = bootV2();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const [first, second] = ctx.graphs.current.nodes();

    expect((document.activeElement as HTMLElement | null)?.dataset.nodeId).toBe(second.id);

    document.querySelector(`[data-node-id="${first.id}"]`)!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.selectedNode()?.id).toBe(first.id);
    expect(ctx.selection.focusedNode()?.id).toBe(first.id);
    expect((document.activeElement as HTMLElement | null)?.dataset.nodeId).toBe(first.id);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.selectedNode()?.id).toBe(second.id);
    expect(ctx.selection.focusedNode()?.id).toBe(second.id);
    expect((document.activeElement as HTMLElement | null)?.dataset.nodeId).toBe(second.id);

    expect(runCommand(ctx, 'selection.node.clear')).toBe(true);
    await settle();
    expect(ctx.selection.selected()).toBeNull();
    expect((document.activeElement as HTMLElement | null)?.dataset.nodeId).toBeUndefined();
  });

  it('edits title from the rendered node and restores empty commits', async () => {
    const ctx = bootV2();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const title = document.querySelector<HTMLElement>('.node-title')!;

    title.textContent = 'Inline';
    expect(runCommand(ctx, 'node.title.commit.enter', { target: title })).toBe(true);
    expect(node.Label.text).toBe('Inline');

    title.textContent = '';
    expect(runCommand(ctx, 'node.title.commit.focusout', { target: title })).toBe(true);
    expect(title.textContent).toBe('Inline');
  });

  it('drags only from the explicit drag handle', async () => {
    const ctx = bootV2();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const before = { ...node.Position! };
    const handle = document.querySelector<HTMLElement>('.node-drag-handle')!;

    expect(handle.hasAttribute('data-drag-handle')).toBe(true);
    expect(document.querySelector('.node-header')?.hasAttribute('data-drag-handle')).toBe(false);

    runCommand(ctx, 'drag.node.start', { event: new PointerEvent('pointerdown', { clientX: 10, clientY: 10 }), target: handle });
    runCommand(ctx, 'drag.node.move', { event: new PointerEvent('pointermove', { clientX: 70, clientY: 30 }), target: document.body });
    runCommand(ctx, 'drag.node.end');

    expect(node.Position!.x).toBeGreaterThan(before.x);
    expect(node.Position!.y).toBeGreaterThan(before.y);
  });

  it('can disable an ability and hide its commands from the model', () => {
    const ctx = bootV2({ 'ability.collapsible': false });

    expect(ctx.contexts.commands.get('node.collapse.toggle')).toBeUndefined();
    expect(ctx.model.entity('node')?.abilities.map(ability => ability.id)).not.toContain('collapsible');
  });

  it('creates, switches, deletes graphs, and cascades node deletion to edges', async () => {
    const ctx = bootV2();
    expect(runCommand(ctx, 'graph.create')).toBe(true);
    expect(ctx.graphs.current.id).toBe('g2');

    expect(runCommand(ctx, 'graph.switch.next')).toBe(true);
    expect(ctx.graphs.current.id).toBe('g1');

    const first = ctx.graphs.current;
    expect(runCommand(ctx, 'graph.delete.current')).toBe(true);
    expect(ctx.graphs.current).not.toBe(first);

    const a = await (async () => { runCommand(ctx, 'editing.node.create'); await settle(); return ctx.graphs.current.nodes().at(-1)!; })();
    const b = await (async () => { runCommand(ctx, 'editing.node.create'); await settle(); return ctx.graphs.current.nodes().at(-1)!; })();
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    expect(ctx.graphs.current.edges()).toHaveLength(1);

    ctx.bus.emit('selection.node.select', { id: a.id });
    expect(runCommand(ctx, 'graph.node.delete.selected')).toBe(true);
    expect(ctx.graphs.current.getNode(a.id)).toBeUndefined();
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });

  it('deletes a selected node with the general X shortcut', async () => {
    const ctx = bootV2();
    const a = await (async () => { runCommand(ctx, 'editing.node.create'); await settle(); return ctx.graphs.current.nodes().at(-1)!; })();
    const b = await (async () => { runCommand(ctx, 'editing.node.create'); await settle(); return ctx.graphs.current.nodes().at(-1)!; })();
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    ctx.bus.emit('selection.node.select', { id: a.id });

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.graphs.current.getNode(a.id)).toBeUndefined();
    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(ctx.selection.selected()).toBeNull();
  });
});
