import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryIo } from '../../frontend/core';
import { touchGestureView } from '../../frontend/systems/view-pan';
import { bootApp, runCommand, settle } from './testkit';

const setWidth = (width: number) => Object.defineProperty(window, 'innerWidth', {
  configurable: true,
  value: width,
});
const click = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('mobile journey interaction budgets', () => {
  beforeEach(() => setWidth(390));
  afterEach(() => setWidth(1024));

  it('uses touch language in the empty canvas instead of keyboard hints', async () => {
    bootApp({ autoLayout: false });
    await settle();
    expect(document.querySelector('.empty-hint')?.textContent).toContain('Tap to add a node');
    expect(document.querySelector('.empty-hint kbd')).toBeNull();
    expect(document.querySelector('.empty-hint')?.textContent).not.toContain('Press');
  });

  it('keeps every command-menu route at three interactions or fewer without keyboard hints', async () => {
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.node.create', { Label: { text: 'Source' }, Description: 'Foldable' });
    ctx.bus.emit('graph.node.create', { Label: { text: 'Target' } });
    await settle();

    expect(runCommand(ctx, 'palette.open', { origin: 'pointer' })).toBe(true); // 1: Tools
    await settle();
    const palette = document.querySelector('.palette-mobile')!;
    expect(palette).not.toBeNull();
    expect(palette.querySelector('.palette-quick')).not.toBeNull();
    expect(palette.querySelectorAll('kbd')).toHaveLength(0);
    expect(document.activeElement).not.toBe(palette.querySelector('.palette-search'));

    const costs = [...palette.querySelectorAll<HTMLElement>('[data-interaction-cost]')]
      .map(element => Number(element.dataset.interactionCost));
    expect(costs.length).toBeGreaterThan(10);
    expect(Math.max(...costs)).toBeLessThanOrEqual(3);
    expect(palette.querySelector('[data-command-id="container.add-child"]')).toBeNull();

    runCommand(ctx, 'help.open', { origin: 'pointer' });
    await settle();
    expect(document.querySelector('.modal-head')?.textContent).toContain('Touch guide');
    expect(document.querySelector('.touch-guide')?.textContent).toContain('Hold node → Connect → tap target');
    expect(document.querySelectorAll('.shortcut-edit')).toHaveLength(0);
  });

  it('keeps four-tap unseeded pickers out of Tools in favor of contextual wheel routes', async () => {
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.node.create', { Label: { text: 'One' } });
    ctx.bus.emit('graph.node.create', { Label: { text: 'Two' } });
    await settle();
    ctx.bus.emit('selection.item.clear');
    runCommand(ctx, 'palette.open', { origin: 'pointer' });
    await settle();
    const palette = document.querySelector('.palette-mobile')!;
    expect(palette.querySelector('[data-command-id="editing.edge.create"]')).toBeNull();
    expect(palette.querySelector('[data-command-id="container.add-child"]')).toBeNull();
  });

  it('offers move-into from an item wheel at a three-interaction cost', async () => {
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.node.create', { Label: { text: 'Move me' } });
    runCommand(ctx, 'editing.container.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const nodeEl = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)!;
    nodeEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    const move = document.querySelector<HTMLElement>('[data-action-command="container.add-child"]')!;
    expect(move).not.toBeNull();
    expect(move.dataset.interactionCost).toBe('3');
  });

  it('links two nodes in exactly three touch interactions through long-press wheel', async () => {
    const ctx = bootApp({ autoLayout: false });
    const source = ctx.graphs.current.createNode({ Label: { text: 'Source' }, Description: 'Foldable', Position: { x: -180, y: 0 } });
    const target = ctx.graphs.current.createNode({ Label: { text: 'Target' }, Position: { x: 180, y: 0 } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: source.id });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: target.id });
    await settle();

    const sourceEl = document.querySelector<HTMLElement>(`.node[data-item-id="${source.id}"]`)!;
    expect(sourceEl.getAttribute('aria-label')).toContain('Hold for actions');
    expect(sourceEl.getAttribute('aria-label')).not.toContain('Press Enter');
    // 1: hold source node.
    const holdStart = new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: 250, clientY: 220,
    });
    expect(runCommand(ctx, 'item.action.hold.start', { event: holdStart, target: sourceEl, origin: 'pointer' })).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 480));
    await settle();
    const wheel = document.querySelector('.item-action-wheel')!;
    expect(wheel).not.toBeNull();
    expect(ctx.selection.selectedNode()?.id).toBe(source.id);
    const wheelCosts = [...wheel.querySelectorAll<HTMLElement>('[data-interaction-cost]')]
      .map(element => Number(element.dataset.interactionCost));
    expect(Math.max(...wheelCosts)).toBeLessThanOrEqual(3);

    // 2: Connect.
    const connect = wheel.querySelector<HTMLElement>('[data-action-command="editing.edge.create"]')!;
    expect(connect.dataset.interactionCost).toBe('3');
    click(connect);
    await settle();
    expect(document.querySelector('.item-action-wheel')).toBeNull();
    expect(document.querySelector('.picker-prompt')?.textContent).toContain('Tap a highlighted item');
    expect(document.querySelector('.picker-prompt')?.textContent).not.toContain('press its letter');

    // 3: target node.
    document.querySelector<HTMLElement>(`.node[data-item-id="${target.id}"]`)!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch' }));
    await settle();
    expect(ctx.graphs.current.edges()).toHaveLength(1);
    expect(ctx.graphs.current.edges()[0]).toMatchObject({ From: source.id, To: target.id });
  });

  it('opens explicit Rename from the shared desktop/mobile wheel in two interactions', async () => {
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.node.create', { Label: { text: 'Rename me' } });
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const nodeEl = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)!;

    // 1: long-press equivalent on pointer desktops is context-click.
    nodeEl.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 240, clientY: 220,
    }));
    await settle();
    const rename = document.querySelector<HTMLElement>('[data-action-command="item.title.edit"]')!;
    expect(rename).not.toBeNull();
    // 2: Rename.
    click(rename);
    await settle();
    expect(document.querySelector('[data-editable-title].editing')).not.toBeNull();
  });

  it('folds a persisted desktop-open navigator on compact boot', async () => {
    const io = memoryIo();
    io.set('frontend.fold', { 'outline.panel': true });
    bootApp({}, io);
    await settle();
    expect(document.querySelector('.graph-navigator')?.getAttribute('data-outline-folded')).toBe('true');
  });
});

describe('two-touch camera transform', () => {
  it('zooms around the centroid while allowing simultaneous two-finger pan', () => {
    const zoomed = touchGestureView(
      { x: 0, y: 0, scale: 1 },
      { x: 100, y: 100 },
      { x: 120, y: 110 },
      100,
      200,
    );
    expect(zoomed).toEqual({ x: 40, y: 45, scale: 2 });

    const panned = touchGestureView(
      { x: 0, y: 0, scale: 1 },
      { x: 100, y: 100 },
      { x: 130, y: 120 },
      100,
      100,
    );
    expect(panned).toEqual({ x: -30, y: -20, scale: 1 });
  });
});
