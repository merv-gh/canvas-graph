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

  it('modal blocks background hotkeys until closed', async () => {
    const ctx = bootV2();
    ctx.graphs.current.createNode({ Label: { text: 'seed' } });
    ctx.bus.emit('item.properties.open', { kind: 'node', id: 'e1' });
    await settle();
    expect(document.querySelector('.modal-layer')).not.toBeNull();
    const before = ctx.graphs.current.nodes().length;

    // 'a' would normally fire editing.node.create. With a modal mounted the
    // input router scopes non-global commands to inside the modal — clicking
    // outside or pressing keys on document.body is a no-op.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.nodes().length).toBe(before);

    // Escape still works because it has `global: true`.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('.modal-layer')?.children.length ?? 0).toBe(0);
  });

  it('clicks on background data-command buttons are blocked while modal is open', async () => {
    const ctx = bootV2();
    ctx.graphs.current.createNode({ Label: { text: 'seed' } });
    ctx.bus.emit('item.properties.open', { kind: 'node', id: 'e1' });
    await settle();
    const before = ctx.graphs.current.nodes().length;

    // Toolbar buttons live outside the modal — clicking them while a modal
    // is up should be a no-op so the modal stays the focus.
    const outsideButton = document.createElement('button');
    outsideButton.dataset.command = 'editing.node.create';
    document.body.append(outsideButton);
    outsideButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.nodes().length).toBe(before);
    outsideButton.remove();
  });

  it('Escape commits an in-progress title edit', async () => {
    const ctx = bootV2();
    const node = ctx.graphs.current.createNode({ Label: { text: 'old' } });
    ctx.bus.emit('selection.node.select', { id: node.id });
    await settle();

    ctx.bus.emit('item.title.edit', { ref: { kind: 'node', id: node.id } });
    await settle();
    const title = document.querySelector(`.node[data-item-kind="node"][data-item-id="${node.id}"] .node-title`) as HTMLElement;
    expect(title.classList.contains('editing')).toBe(true);
    title.textContent = 'new';

    pressEscape();
    await settle();
    expect(title.classList.contains('editing')).toBe(false);
    expect(ctx.graphs.current.getNode(node.id)?.Label.text).toBe('new');
  });
});
