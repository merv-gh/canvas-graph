import { describe, expect, it } from 'vitest';
import { memoryIo } from '../../frontend/core';
import { bootApp, runCommand, settle } from './testkit';

const panel = () => document.querySelector<HTMLElement>('.tool-panel[data-panel-id="palette"]');
const tiles = () => [...document.querySelectorAll<HTMLElement>('.palette-catalog-block [data-palette-catalog]')];
const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const bootPalette = (flags = {}, io = memoryIo()) => {
  const ctx = bootApp(flags, io);
  ctx.contexts.fold.set('outline.panel', true);
  return ctx;
};

describe('persistent node palette', () => {
  it('searches the categorized catalog and keeps saved types below it', async () => {
    const io = memoryIo();
    const ctx = bootPalette({}, io);
    await settle();
    ctx.bus.emit('preset.type.register', {
      preset: 'none', entry: { id: 'saved-worker', label: 'Saved worker', value: 'service' },
    });
    await settle();

    const search = document.querySelector<HTMLInputElement>('[data-graph-nav-search]')!;
    search.value = 'approval';
    expect(runCommand(ctx, 'outline.search.change', { target: search })).toBe(true);
    await settle();
    expect([...document.querySelectorAll<HTMLElement>('[data-palette-catalog]')]
      .map(tile => tile.dataset.paletteType)).toEqual(['approval-gate']);

    search.value = '';
    runCommand(ctx, 'outline.search.change', { target: search });
    await settle();
    const autonomous = document.querySelector<HTMLElement>('[data-palette-category="Autonomous systems"]')!;
    expect(runCommand(ctx, 'palette.category.set', { target: autonomous })).toBe(true);
    await settle();
    expect([...document.querySelectorAll<HTMLElement>('[data-palette-catalog]')]
      .map(tile => tile.dataset.paletteType)).toEqual([
        'agent', 'timeline-step', 'data-table', 'toggle', 'artifact', 'approval-gate',
      ]);
    const catalog = document.querySelector('.palette-catalog-block')!;
    const saved = document.querySelector('.palette-saved-block')!;
    expect(catalog.compareDocumentPosition(saved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reuses any catalog node type with its declared visual and size', async () => {
    const ctx = bootPalette();
    await settle();
    click(document.querySelector<HTMLElement>('[data-palette-catalog][data-palette-type="data-table"]')!);
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    expect(node).toMatchObject({ NodeType: 'data-table', Size: { w: 300, h: 190 } });
    expect(document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)?.dataset.nodeVisual).toBe('table');
  });

  it('mounts one universal catalog without collection tabs or a current-collection block', async () => {
    const ctx = bootPalette();
    await settle();
    expect(panel()).not.toBeNull();
    expect(tiles().map(tile => tile.dataset.paletteType)).toEqual(expect.arrayContaining([
      'text', 'square', 'circle', 'diamond', 'agent', 'data-table', 'approval-gate',
    ]));
    expect(document.querySelector('[data-palette-preset-choice]')).toBeNull();
    expect(panel()?.textContent).not.toContain('Current collection');
    expect(panel()?.textContent).not.toContain('No collection matches');
    expect(panel()?.querySelector('.palette-sheet > header')).toBeNull();
    const sheet = document.querySelector<HTMLElement>('.palette-sheet')!;
    const before = ctx.contexts.view.get();
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 240 });
    sheet.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    await settle();
    expect(ctx.contexts.view.get()).toEqual(before);
  });

  it('arms an entry, color, fill, and border for the next normal create', async () => {
    const ctx = bootPalette();
    await settle();
    ctx.bus.emit('preset.set', { preset: 'flowchart' });
    await settle();
    click(document.querySelector<HTMLElement>('[data-command="palette.arm.type.diamond"]')!);
    runCommand(ctx, 'palette.arm.color.red');
    runCommand(ctx, 'palette.arm.fill.solid');
    runCommand(ctx, 'palette.arm.border.none');
    runCommand(ctx, 'editing.node.create');
    await settle();

    const node = ctx.graphs.current.nodes()[0]!;
    expect(node.NodeType).toBe('diamond');
    expect(node.Color).toBe('red');
    expect(node.Fill).toBe('solid');
    expect(node.BorderColor).toBe('none');
    expect(node.Size).toEqual({ w: 112, h: 112 });
    const rendered = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)!;
    expect(rendered.dataset.nodeColor).toBe('red');
    expect(rendered.dataset.fill).toBe('solid');
    expect(rendered.dataset.borderColor).toBe('none');
  });

  it('keeps duplicate-shape collection entries distinct', async () => {
    const ctx = bootPalette();
    await settle();
    ctx.bus.emit('preset.set', { preset: 'jira' });
    await settle();
    const boxes = tiles().filter(tile => tile.dataset.palettePreset === 'jira' && tile.dataset.paletteType === 'square');
    expect(boxes).toHaveLength(5);
    click(boxes[1]!); // In progress: yellow solid, not first square's gray solid.
    await settle();
    let currentBoxes = tiles().filter(tile => tile.dataset.palettePreset === 'jira' && tile.dataset.paletteType === 'square');
    expect(currentBoxes.findIndex(tile => tile.getAttribute('aria-pressed') === 'true')).toBe(1);
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(ctx.graphs.current.nodes()[0]).toMatchObject({
      Label: { text: 'In progress' }, NodeType: 'square', Color: 'yellow', Fill: 'solid',
    });

    currentBoxes = tiles().filter(tile => tile.dataset.palettePreset === 'jira' && tile.dataset.paletteType === 'square');
    click(currentBoxes[0]!); // Open shares visuals with Reopened; identity stays exact.
    await settle();
    expect(ctx.graphs.current.nodes()[0].Label.text).toBe('Open');
    currentBoxes = tiles().filter(tile => tile.dataset.palettePreset === 'jira' && tile.dataset.paletteType === 'square');
    expect(currentBoxes.findIndex(tile => tile.getAttribute('aria-pressed') === 'true')).toBe(0);
  });

  it('switching an internal demo preset resets the arm without changing the universal catalog', async () => {
    const ctx = bootPalette();
    await settle();
    const before = tiles().map(tile => `${tile.dataset.palettePreset}:${tile.dataset.paletteType}:${tile.textContent}`);
    runCommand(ctx, 'palette.arm.color.red');
    ctx.bus.emit('preset.set', { preset: 'architecture' });
    await settle();
    expect(tiles().map(tile => `${tile.dataset.palettePreset}:${tile.dataset.paletteType}:${tile.textContent}`)).toEqual(before);
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(ctx.graphs.current.nodes()[0]).toMatchObject({ NodeType: 'dense', Color: 'blue', Fill: 'soft' });
  });

  it('creates, saves, and immediately arms a custom palette type', async () => {
    const io = memoryIo();
    const ctx = bootPalette({}, io);
    await settle();

    expect(document.querySelector('[data-command="palette.custom-type.create"]')?.textContent).toContain('New type');
    expect(runCommand(ctx, 'palette.custom-type.create')).toBe(true);
    await settle();

    const set = (id: string, value: string) => {
      const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-form-field="${id}"]`)!;
      control.value = value;
    };
    set('label', 'Critical service');
    set('shape', 'pill');
    set('color', 'purple');
    set('fill', 'solid');
    set('border', 'red');
    const submit = document.querySelector<HTMLElement>('[data-command="commandForm.submit"]')!;
    expect(runCommand(ctx, 'commandForm.submit', { target: submit })).toBe(true);
    await settle();

    const custom = document.querySelector<HTMLElement>('[data-palette-custom-type]')!;
    expect(custom.textContent).toContain('Critical service');
    expect(custom.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-place="stage"]')?.classList.contains('node-placing')).toBe(true);
    expect(io.get<any[]>('presets:types:user', [])).toEqual([
      expect.objectContaining({
        preset: 'none',
        entry: expect.objectContaining({
          label: 'Critical service', value: 'pill', color: 'purple', fill: 'solid', border: 'red',
        }),
      }),
    ]);

    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(ctx.graphs.current.nodes()[0]).toMatchObject({
      Label: { text: 'Critical service' }, NodeType: 'pill', Color: 'purple', Fill: 'solid', BorderColor: 'red',
    });

    bootPalette({}, io);
    await settle();
    expect(document.querySelector('[data-palette-custom-type]')?.textContent).toContain('Critical service');
  });

  it('renames and safely deletes a persisted custom type', async () => {
    const io = memoryIo();
    const ctx = bootPalette({}, io);
    await settle();
    ctx.bus.emit('preset.type.register', {
      preset: 'none',
      entry: { id: 'custom-worker', label: 'Worker', value: 'service', color: 'blue', fill: 'soft' },
    });
    await settle();

    click(document.querySelector<HTMLElement>('[data-command="palette.custom-type.rename"]')!);
    await settle();
    const name = document.querySelector<HTMLInputElement>('[data-form-field="label"]')!;
    expect(name.value).toBe('Worker');
    name.value = 'Background worker';
    expect(runCommand(ctx, 'commandForm.submit', {
      target: document.querySelector<HTMLElement>('[data-command="commandForm.submit"]')!,
    })).toBe(true);
    await settle();
    expect(document.querySelector('[data-palette-custom-type]')?.textContent).toContain('Background worker');
    expect(io.get<any[]>('presets:types:user', [])[0].entry.label).toBe('Background worker');

    click(document.querySelector<HTMLElement>('[data-command="palette.custom-type.delete.request"]')!);
    await settle();
    expect(document.querySelector('.modal-slot')?.textContent).toContain('Existing nodes will not change');
    expect(runCommand(ctx, 'palette.custom-type.delete.confirm')).toBe(true);
    await settle();
    expect(document.querySelector('[data-palette-custom-type]')).toBeNull();
    expect(io.get('presets:types:user', [])).toEqual([]);

    bootPalette({}, io);
    await settle();
    expect(document.querySelector('[data-palette-custom-type]')).toBeNull();
  });

  it('does not override explicitly styled creates', async () => {
    const ctx = bootPalette();
    await settle();
    runCommand(ctx, 'palette.arm.type.diamond');
    ctx.bus.emit('graph.node.create', { Label: { text: 'Imported' }, NodeType: 'circle', Color: 'green' });
    await settle();
    expect(ctx.graphs.current.nodes()[0]).toMatchObject({ NodeType: 'circle', Color: 'green' });
  });

  it('turns a type tile into a persistent canvas placement tool', { timeout: 10_000 }, async () => {
    const ctx = bootPalette();
    await settle();
    click(document.querySelector<HTMLElement>('[data-command="palette.arm.type.diamond"]')!);
    await settle();
    const stage = document.querySelector<HTMLElement>('[data-place="stage"]')!;
    expect(stage.classList.contains('node-placing')).toBe(true);
    expect(document.querySelector('.palette-panel')?.getAttribute('data-placing')).toBe('true');

    stage.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: 320, clientY: 240,
    }));
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    expect(ctx.graphs.current.nodes()[0]).toMatchObject({
      NodeType: 'diamond', Position: { x: 320, y: 240 }, Size: { w: 112, h: 112 },
    });
    expect(stage.classList.contains('node-placing')).toBe(true);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(stage.classList.contains('node-placing')).toBe(false);
  });

  it('creates real C4 systems and containers, including empty ones', { timeout: 10_000 }, async () => {
    const ctx = bootPalette({ autoLayout: false });
    await settle();
    ctx.bus.emit('preset.set', { preset: 'c4' });
    await settle();
    const system = tiles().find(tile => tile.dataset.palettePreset === 'c4' && tile.textContent?.includes('System'))!;
    click(system);
    const stage = document.querySelector<HTMLElement>('[data-place="stage"]')!;
    stage.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: 360, clientY: 260,
    }));
    await settle();

    expect(ctx.graphs.current.nodes()).toHaveLength(0);
    const containers = ctx.graphs.current.itemsOfKind<any>('container');
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      ContainerType: 'c4-system', Color: 'blue', Size: { w: 560, h: 360 }, Children: [],
    });
    const rendered = document.querySelector<HTMLElement>(`.container[data-item-id="${containers[0].id}"]`)!;
    expect(rendered.dataset.containerType).toBe('c4-system');
    expect(rendered.dataset.containerColor).toBe('blue');
  });

  it('turns selected nodes into a semantic C4 container from the palette', async () => {
    const ctx = bootPalette({ autoLayout: false });
    await settle();
    ctx.bus.emit('preset.set', { preset: 'c4' });
    const a = ctx.graphs.current.createNode({ Label: { text: 'API' }, Position: { x: 0, y: 0 } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'DB' }, Position: { x: 180, y: 0 } });
    ctx.bus.emit('selection.choose', {
      refs: [{ kind: 'node', id: a.id }, { kind: 'node', id: b.id }], mode: 'replace',
    });
    await settle();

    click(tiles().find(tile => tile.dataset.palettePreset === 'c4' && tile.textContent?.includes('Container'))!);
    await settle();
    const containers = ctx.graphs.current.itemsOfKind<any>('container');
    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({ ContainerType: 'c4-container', Color: 'purple' });
    expect(containers[0].Children.map((ref: { id: string }) => ref.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('applies palette type, color, fill, and border to selected nodes', async () => {
    const ctx = bootPalette();
    await settle();
    ctx.bus.emit('graph.node.create', { Label: { text: 'One' } });
    ctx.bus.emit('graph.node.create', { Label: { text: 'Two' } });
    await settle();
    const refs = ctx.graphs.current.nodes().map(node => ({ kind: 'node' as const, id: node.id }));
    ctx.bus.emit('selection.choose', { refs, mode: 'replace' });
    await settle();

    runCommand(ctx, 'palette.arm.type.diamond');
    runCommand(ctx, 'palette.arm.color.purple');
    runCommand(ctx, 'palette.arm.fill.solid');
    runCommand(ctx, 'palette.arm.border.none');
    await settle();
    expect(ctx.graphs.current.nodes()).toEqual(expect.arrayContaining([
      expect.objectContaining({ NodeType: 'diamond', Color: 'purple', Fill: 'solid', BorderColor: 'none' }),
      expect.objectContaining({ NodeType: 'diamond', Color: 'purple', Fill: 'solid', BorderColor: 'none' }),
    ]));
  });

  it('applies color and line kind to a selected edge and serializes them', async () => {
    const ctx = bootPalette();
    await settle();
    ctx.bus.emit('graph.node.create', { Label: { text: 'From' } });
    ctx.bus.emit('graph.node.create', { Label: { text: 'To' } });
    await settle();
    const [from, to] = ctx.graphs.current.nodes();
    ctx.bus.emit('graph.edge.create', { From: from.id, To: to.id });
    await settle();
    const edge = ctx.graphs.current.edges()[0]!;
    ctx.selection.select({ kind: 'edge', id: edge.id });
    await settle();

    runCommand(ctx, 'palette.arm.color.green');
    runCommand(ctx, 'palette.edge.kind.dashed');
    await settle();
    expect(ctx.graphs.current.getEdge(edge.id)).toMatchObject({ Color: 'green', EdgeKind: 'dashed' });
    expect(document.querySelector(`.edge[data-edge-color="green"] .edge-line.edge-kind-dashed`)).not.toBeNull();
    expect(ctx.graphs.current.snapshot().edges[0]).toMatchObject({ Color: 'green', EdgeKind: 'dashed' });
  });

  it('supports palette-off boot and leaves node creation intact', async () => {
    const ctx = bootApp({ palette: false, dx: false });
    await settle();
    expect(panel()).toBeNull();
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
  });

  it('mobile toggle keeps the sheet collapsed by default and supports scrim close', async () => {
    bootPalette();
    await settle();
    const root = document.querySelector<HTMLElement>('.palette-panel')!;
    expect(root.dataset.mobileOpen).toBe('false');
    click(document.querySelector<HTMLElement>('[data-command="palette.mobile.toggle"]')!);
    await settle();
    expect(document.querySelector<HTMLElement>('.palette-panel')!.dataset.mobileOpen).toBe('true');
    click(document.querySelector<HTMLElement>('[data-command="palette.mobile.close"]')!);
    await settle();
    expect(document.querySelector<HTMLElement>('.palette-panel')!.dataset.mobileOpen).toBe('false');
  });
});
