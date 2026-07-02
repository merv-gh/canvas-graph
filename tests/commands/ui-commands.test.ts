import { describe, expect, it } from 'vitest';
import { bootApp, commandButton, runCommand, settle } from './testkit';

const createNodes = async (ctx: ReturnType<typeof bootApp>, count: number) => {
  for (let i = 0; i < count; i++) runCommand(ctx, 'editing.node.create');
  await settle();
  return ctx.graphs.current.nodes();
};

describe('frontend UI command surfaces', () => {
  it('renders the top toolbar with graph-editing and layout button groups', async () => {
    const ctx = bootApp();
    await createNodes(ctx, 2);

    // Graph-editing actions cluster in the top bar's `edit` group.
    expect(document.querySelector('.tool-panel[data-panel-id="top"] .tool-group[data-group="edit"] [data-command="editing.node.create"]')?.textContent).toBe('+ Node');
    expect(document.querySelector('.tool-panel[data-panel-id="top"] .tool-group[data-group="edit"] [data-command="editing.edge.create"]')?.textContent).toBe('+ Edge');
    // Layout lives in its own separate panel, not the top bar.
    expect(document.querySelector('.tool-panel[data-panel-id="layout"] [data-command="layout.apply.tidy"]')?.textContent).toBe('Tidy');
    expect(document.querySelector('.tool-panel[data-panel-id="top"] [data-command="layout.apply.tidy"]')).toBeNull();
    // Search icon lives in the trailing (right) toolbar slot.
    expect(document.querySelector('.top-tool-panel .toolbar-end [data-command="palette.open"]')).not.toBeNull();
    // Outline is a left place now; the old top-bar hamburger stays gone.
    expect(document.querySelector('.outline-panel')).not.toBeNull();
    expect(document.querySelector('.top-tool-panel .hamburger')).toBeNull();
    expect(ctx.bus['_emitted'].has('render.view.set')).toBe(true);
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

  it('navigates rows with arrow keys and runs the highlighted one on Enter', async () => {
    const ctx = bootApp();

    expect(runCommand(ctx, 'palette.open')).toBe(true);
    const search = document.querySelector<HTMLInputElement>('.palette-search')!;
    search.value = 'create node';
    expect(runCommand(ctx, 'commandModal.search.change', { target: search })).toBe(true);

    // First row is highlighted by default; Enter runs it.
    expect(document.querySelector('.command-row.is-selected')).not.toBeNull();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    expect(document.querySelector('.modal-layer')).toBeNull();
  });

  it('gives each search result an Alt+<unique-key> accelerator', async () => {
    const ctx = bootApp();
    expect(runCommand(ctx, 'palette.open')).toBe(true);
    const search = document.querySelector<HTMLInputElement>('.palette-search')!;
    search.value = 'create';
    expect(runCommand(ctx, 'commandModal.search.change', { target: search })).toBe(true);

    const chips = [...document.querySelectorAll('.command-row kbd')].map(k => k.textContent);
    // The first result after "create" is "... node/edge" → an Alt accelerator shows.
    expect(chips.some(text => /⌥/.test(text ?? ''))).toBe(true);
  });

  it('opens the palette via the ? shortcut alias', async () => {
    const ctx = bootApp();
    await settle();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('.modal-head')?.textContent).toContain('Palette');
    expect(document.querySelector('[data-command-modal="palette"]')).not.toBeNull();
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
