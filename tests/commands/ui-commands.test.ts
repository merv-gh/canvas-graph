import { describe, expect, it } from 'vitest';
import { bootApp, commandButton, runCommand, settle } from './testkit';

const createNodes = async (ctx: ReturnType<typeof bootApp>, count: number) => {
  for (let i = 0; i < count; i++) runCommand(ctx, 'editing.node.create');
  await settle();
  return ctx.graphs.current.nodes();
};

describe('frontend UI command surfaces', () => {
  it('renders toolbar, outline title-search, and event log from command metadata', async () => {
    const ctx = bootApp();
    await createNodes(ctx, 2);

    expect(document.querySelector('.top-tool-panel [data-command="editing.node.create"]')?.textContent).toBe('+ Node');
    expect(document.querySelector('.top-tool-panel [data-command="editing.edge.create"]')?.textContent).toBe('+ Edge');
    expect(document.querySelectorAll('.outline-search')).toHaveLength(0);

    const search = document.querySelector<HTMLInputElement>('.outline-title-search[placeholder="Nodes"]')!;
    search.value = 'node 2';
    expect(runCommand(ctx, 'outline.search.change', { target: search })).toBe(true);
    expect([...document.querySelectorAll('.outline-section:has(.outline-title-search[placeholder="Nodes"]) .outline-main')]
      .map(row => row.textContent)).toEqual(['Node 2']);
    expect(document.querySelector('.log-row')?.textContent).toContain('outline.search.changed');
  });

  it('opens palette, filters commands, and runs a command row', async () => {
    const ctx = bootApp();
    // Edge create command picker needs nodes to pick between — pre-create.
    ctx.graphs.current.createNode({ Label: { text: 'A' } });
    ctx.graphs.current.createNode({ Label: { text: 'B' } });
    await settle();

    expect(runCommand(ctx, 'palette.open')).toBe(true);
    expect(document.querySelector('.modal-head')?.textContent).toContain('Palette');
    const search = document.querySelector<HTMLInputElement>('.palette-search')!;
    search.value = 'edge';
    expect(runCommand(ctx, 'commandModal.search.change', { target: search })).toBe(true);
    expect([...document.querySelectorAll('.command-row b')].some(row => row.textContent?.includes('Create edge'))).toBe(true);

    const row = [...document.querySelectorAll<HTMLElement>('.command-row')]
      .find(candidate => candidate.dataset.commandId === 'editing.edge.create')!;
    expect(row.querySelector('kbd')?.textContent).toContain('E');
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    // Edge create is now picker-driven — the palette closes and a picker
    // prompt appears asking for the source node.
    expect(document.querySelector('.picker-prompt')?.textContent).toContain('Pick');
    expect(document.querySelector('input[data-keyboard-mode="commandPicker"]')).not.toBeNull();
  });

  it('runs numbered palette rows and closes after simple actions', async () => {
    const ctx = bootApp();

    expect(runCommand(ctx, 'palette.open')).toBe(true);
    const search = document.querySelector<HTMLInputElement>('.palette-search')!;
    search.value = 'create node';
    expect(runCommand(ctx, 'commandModal.search.change', { target: search })).toBe(true);

    search.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    expect(document.querySelector('.modal-layer')).toBeNull();
  });

  it('opens help and blocks duplicate shortcut edits', () => {
    const ctx = bootApp();

    expect(runCommand(ctx, 'help.open')).toBe(true);
    const help = document.querySelector<HTMLInputElement>('.shortcut-edit[data-shortcut-command="help.open"]')!;
    help.value = 'P';
    expect(runCommand(ctx, 'shortcut.edit.preview', { target: help })).toBe(true);
    expect(help.classList.contains('is-conflict')).toBe(true);
    expect(runCommand(ctx, 'shortcut.edit.commit', { target: help })).toBe(true);
    expect(ctx.contexts.commands.get('help.open')?.shortcut).toBe('?');

    help.value = 'H';
    expect(runCommand(ctx, 'shortcut.edit.preview', { target: help })).toBe(true);
    expect(help.classList.contains('is-conflict')).toBe(false);
    expect(runCommand(ctx, 'shortcut.edit.commit', { target: help })).toBe(true);
    expect(ctx.contexts.commands.get('help.open')?.shortcut).toBe('H');
  });

  it('updates view through zoom, pan, fit, and layout commands', async () => {
    const ctx = bootApp();
    const nodes = await createNodes(ctx, 4);
    ctx.bus.emit('selection.node.select', { id: nodes[0].id });
    ctx.bus.emit('focus.node.focus', { id: nodes[0].id });
    ctx.bus.emit('graph.edge.create', { From: nodes[0].id, To: nodes[1].id });
    ctx.bus.emit('graph.edge.create', { From: nodes[1].id, To: nodes[2].id });

    const start = ctx.contexts.view.get();
    expect(runCommand(ctx, 'view.zoom.in')).toBe(true);
    expect(ctx.contexts.view.get().scale).toBeGreaterThan(start.scale);
    expect(runCommand(ctx, 'view.zoom.out')).toBe(true);
    expect(runCommand(ctx, 'view.zoom.reset')).toBe(true);
    expect(ctx.contexts.view.get()).toEqual({ x: 0, y: 0, scale: 1 });

    ctx.bus.emit('view.pan.start', { x: 10, y: 10 });
    ctx.bus.emit('view.pan.move', { x: 90, y: 50 });
    expect(ctx.contexts.view.get().x).toBeLessThan(0);
    ctx.bus.emit('view.pan.end');

    expect(runCommand(ctx, 'layout.apply.grid')).toBe(true);
    expect(runCommand(ctx, 'layout.apply.radial')).toBe(true);
    expect(runCommand(ctx, 'layout.apply.tidy')).toBe(true);
    expect(runCommand(ctx, 'view.fit.all')).toBe(true);
    expect(ctx.contexts.view.get().scale).toBeGreaterThan(0);
    expect(runCommand(ctx, 'view.fit.selected')).toBe(true);
  });

  it('renders the demo self graph through commands', async () => {
    const ctx = bootApp();

    expect(runCommand(ctx, 'demo.render-self')).toBe(true);
    await settle();

    expect(ctx.graphs.current.nodes().length).toBeGreaterThan(10);
    expect(ctx.graphs.current.edges().length).toBeGreaterThan(5);
  });
});
