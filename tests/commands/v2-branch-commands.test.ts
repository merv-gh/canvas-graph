import { describe, expect, it } from 'vitest';
import { localStorageIo } from '../../v2/core';
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

    expect(runCommand(ctx, 'modal.open', { target: document.createElement('button') })).toBe(true);
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
    expect(ctx.selection.selected()).toBe(ids[0]);
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
});
