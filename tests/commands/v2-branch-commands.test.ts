import { describe, expect, it } from 'vitest';
import { createAppContext, createFlags, localStorageIo, memoryIo, registry } from '../../v2/core';
import { graphStore } from '../../v2/model';
import { registerCollections } from '../../v2/systems/collections';
import { runDx } from '../../v2/systems/dx';
import type { ModelDef } from '../../v2/types';
import { bootV2, commandButton, runCommand, settle } from './v2-testkit';

describe('v2 defensive command branches', () => {
  it('covers localStorage IO success and fallback paths', () => {
    const io = localStorageIo();
    io.set('ok', { value: 1 });
    expect(io.get('ok', null)).toEqual({ value: 1 });
    localStorage.setItem('bad-json', '{');
    expect(io.get('bad-json', 'fallback')).toBe('fallback');
    expect(io.keys()).toContain('ok');
    io.del('ok');
    expect(io.get('ok', 'gone')).toBe('gone');
  });

  it('runs modal default, close, and malformed command form paths', () => {
    const ctx = bootV2();

    // modal.open is an event other systems emit (no user command/button now).
    ctx.bus.emit('modal.open', {});
    expect(document.querySelector('.modal-head')?.textContent).toContain('Modal');
    expect(runCommand(ctx, 'modal.close')).toBe(true);
    expect(document.querySelector('.modal-layer')).toBeNull();

    ctx.bus.emit('commandForm.open', { commandId: 'missing.command' });
    ctx.bus.emit('commandForm.submit', { commandId: 'missing.command', values: {} });
    expect(document.querySelector('.modal-layer')).toBeNull();
  });

  it('runs selection next, clear, and unavailable selected-only commands', async () => {
    const ctx = bootV2();

    expect(runCommand(ctx, 'selection.node.next')).toBe(false);
    expect(runCommand(ctx, 'view.fit.selected')).toBe(false);
    expect(runCommand(ctx, 'node.title.edit')).toBe(false);

    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const ids = ctx.graphs.current.nodes().map(node => node.id);

	    expect(runCommand(ctx, 'selection.node.next')).toBe(true);
	    expect(ctx.selection.selectedNode()?.id).toBe(ids[0]);
	    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
	    await settle();
	    expect(ctx.selection.selectedNode()?.id).toBe(ids[1]);
	    expect(runCommand(ctx, 'selection.node.clear')).toBe(true);
    expect(ctx.selection.selected()).toBeNull();
  });

  it('runs pan and wheel zoom through command payloads', async () => {
    const ctx = bootV2();
    const stage = ctx.contexts.places.el('stage')!;

    expect(runCommand(ctx, 'view.zoom.wheel', {
      event: new WheelEvent('wheel', { clientX: 40, clientY: 50, deltaY: -100 }),
      target: stage,
    })).toBe(true);
    expect(ctx.contexts.view.get().scale).toBeGreaterThan(1);

    expect(runCommand(ctx, 'view.pan.start', {
      event: new PointerEvent('pointerdown', { clientX: 10, clientY: 10 }),
      target: stage,
    })).toBe(true);
    expect(runCommand(ctx, 'view.pan.move', {
      event: new PointerEvent('pointermove', { clientX: 80, clientY: 20 }),
      target: document.body,
    })).toBe(true);
    expect(runCommand(ctx, 'view.pan.end', {
      event: new PointerEvent('pointerup'),
      target: document.body,
    })).toBe(true);
    expect(stage.classList.contains('panning')).toBe(false);
  });

  it('runs missing-data paths for graph, layout, command modal, and title edit', async () => {
    const ctx = bootV2();

    ctx.bus.emit('graph.switch', { id: 'fresh' });
    expect(ctx.graphs.current.id).toBe('fresh');
    ctx.bus.emit('graph.node.update', { id: 'missing', patch: { Label: { text: 'x' } } });
    ctx.bus.emit('graph.node.delete', { id: 'missing' });
    ctx.bus.emit('graph.edge.delete', { id: 'missing' });

    expect(runCommand(ctx, 'layout.apply.radial')).toBe(true);
    expect(runCommand(ctx, 'layout.apply.tidy')).toBe(true);

    ctx.bus.emit('commandModal.search.changed', { modalId: 'missing', query: 'x' });
    ctx.bus.emit('shortcut.edit.preview', { id: 'missing' });
    ctx.bus.emit('shortcut.edit.commit', { id: 'missing' });

    ctx.bus.emit('node.title.edit', { id: 'missing' });
    ctx.bus.emit('node.title.commit', { id: 'missing', text: '', finish: true });
    await settle();

    expect(commandButton('editing.node.create')).not.toBeNull();
  });

  it('derives collection toolbar defaults and honors toolbar opt-out', () => {
    const model: ModelDef<{ graphs: ReturnType<typeof graphStore> }> = {
      entities: [],
      collections: [
        { id: 'foos', label: 'Foos', items: () => [{ id: 'f1' }] },
        { id: 'bars', label: 'Bars', kind: 'bar', toolbar: false, items: () => [{ id: 'b1' }] },
      ],
    };
    const ctx = createAppContext(graphStore(), model, createFlags({}, memoryIo()), memoryIo());
    const systems = registry('system');

    registerCollections(systems);
    systems.start(ctx);

    const top = ctx.contexts.affordances.system('top');
    expect(top.some(aff => aff.command === 'editing.foo.create' && aff.text === '+ foo')).toBe(true);
    expect(top.some(aff => aff.command === 'editing.bar.create')).toBe(false);
  });

  it('reports model coverage gaps for id-less collection items and unknown graph event kinds', () => {
    const model: ModelDef<{ graphs: ReturnType<typeof graphStore> }> = {
      entities: [],
      collections: [{ id: 'things', label: 'Things', items: () => [{}] }],
    };
    const ctx = createAppContext(graphStore(), model, createFlags({}, memoryIo()), memoryIo());

    ctx.bus.forward('graph.widget.create' as never, {});
    const issues = runDx(ctx);

    expect(issues.some(issue => issue.rule === 'collection.item-id-missing')).toBe(true);
    expect(issues.some(issue => issue.rule === 'entity.kind-no-declaration' && issue.message.includes('widget'))).toBe(true);
    expect(issues.some(issue => issue.rule === 'entity.kind-no-collection' && issue.message.includes('widget'))).toBe(true);
  });
});
