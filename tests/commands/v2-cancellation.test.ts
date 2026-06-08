import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';

const pressEscape = () =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

const stageBackgroundClick = (ctx: ReturnType<typeof bootV2>) => {
  const stage = document.querySelector('[data-place="stage"]')!;
  stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
};

describe('first-class cancellation', () => {
  it('Escape clears selection when nothing more specific is active', async () => {
    const ctx = bootV2();
    ctx.graphs.current.createNode({ Label: { text: 'A' } });
    ctx.bus.emit('selection.node.select', { id: 'e1' });
    await settle();
    expect(ctx.selection.selected()).not.toBeNull();

    pressEscape();
    await settle();
    expect(ctx.selection.selected()).toBeNull();
  });

  it('Escape pops the topmost transient mode before touching selection', async () => {
    const ctx = bootV2();
    ctx.graphs.current.createNode({ Label: { text: 'A' } });
    ctx.bus.emit('selection.node.select', { id: 'e1' });
    await settle();

    runCommand(ctx, 'jump.start');
    await settle();
    expect(document.querySelector('.jump-letter')).not.toBeNull();
    const beforeSelected = ctx.selection.selected();

    pressEscape();
    await settle();

    // Jump cancelled; selection untouched (priority wins).
    expect(document.querySelector('.jump-letter')).toBeNull();
    expect(ctx.selection.selected()).toEqual(beforeSelected);

    // Second Escape peels the next layer — selection.
    pressEscape();
    await settle();
    expect(ctx.selection.selected()).toBeNull();
  });

  it('background click on stage cancels the topmost active mode', async () => {
    const ctx = bootV2();
    ctx.graphs.current.createNode({ Label: { text: 'A' } });
    await settle();

    runCommand(ctx, 'jump.start');
    await settle();
    expect(document.querySelector('.jump-letter')).not.toBeNull();

    stageBackgroundClick(ctx);
    await settle();
    expect(document.querySelector('.jump-letter')).toBeNull();
  });

  it('exposes who is currently cancellable for devtools/tests', async () => {
    const ctx = bootV2();
    ctx.graphs.current.createNode({ Label: { text: 'A' } });
    ctx.bus.emit('selection.node.select', { id: 'e1' });
    await settle();
    expect(ctx.contexts.cancellation.active()).toContain('ability.selectable');

    runCommand(ctx, 'jump.start');
    await settle();
    const active = ctx.contexts.cancellation.active();
    expect(active).toContain('jump');
    expect(active).toContain('ability.selectable');
  });

  it('Escape commits an in-progress title edit', async () => {
    const ctx = bootV2();
    const node = ctx.graphs.current.createNode({ Label: { text: 'old' } });
    ctx.bus.emit('selection.node.select', { id: node.id });
    await settle();

    ctx.bus.emit('node.title.edit', { id: node.id });
    await settle();
    const title = document.querySelector(`.node[data-node-id="${node.id}"] .node-title`) as HTMLElement;
    expect(title.classList.contains('editing')).toBe(true);
    title.textContent = 'new';

    pressEscape();
    await settle();
    expect(title.classList.contains('editing')).toBe(false);
    expect(ctx.graphs.current.getNode(node.id)?.Label.text).toBe('new');
  });
});
