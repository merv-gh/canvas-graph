import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import { inkBounds, smoothInkPath, type InkStroke } from '../../frontend/systems/ink';

/** Free-form ink annotations: draw-mode toggle, the stroke gesture (bus-level,
 *  matching the pointer command payloads), selection delete, styling patches,
 *  and snapshot persistence. */

const strokes = (ctx: ReturnType<typeof bootApp>) =>
  ctx.graphs.current.itemsOfKind<InkStroke>('ink');

const stage = () => document.querySelector<HTMLElement>('[data-place="stage"]')!;

const drawStroke = async (ctx: ReturnType<typeof bootApp>, points: { x: number; y: number }[]) => {
  ctx.bus.emit('ink.stroke.start', { point: points[0] });
  for (const point of points.slice(1)) ctx.bus.emit('ink.stroke.move', { point });
  ctx.bus.emit('ink.stroke.end');
  await settle();
};

describe('ink annotations', () => {
  it('smooths a polyline into one continuous quadratic path', () => {
    expect(smoothInkPath([])).toBe('');
    expect(smoothInkPath([{ x: 1, y: 2 }, { x: 8, y: 9 }])).toBe('M 1 2 L 8 9');
    const d = smoothInkPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d).toContain('Q 10 0 10 5');
    expect(d).toContain('Q 10 10 5 10');
    expect(d.endsWith('L 0 10')).toBe(true);
    expect(inkBounds([{ x: -5, y: 2 }, { x: 15, y: 30 }])).toEqual({ x: -5, y: 2, w: 20, h: 28 });
  });

  it('toggles draw mode with a top-bar command and Escape exits it', async () => {
    const ctx = bootApp();
    await settle();
    const modes: boolean[] = [];
    ctx.bus.on('ink.mode.changed', ({ drawing }) => modes.push(drawing));

    const drawSwitch = document.querySelector<HTMLElement>('.tool-panel[data-panel-id="top"] [data-command="ink.toggle"]')!;
    expect(drawSwitch.getAttribute('role')).toBeNull();
    expect(drawSwitch.getAttribute('aria-pressed')).toBe('false');
    expect(runCommand(ctx, 'ink.toggle')).toBe(true);
    await settle();
    expect(stage().classList.contains('ink-drawing')).toBe(true);
    expect(document.querySelector('[data-command="ink.toggle"]')?.getAttribute('aria-pressed')).toBe('true');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(stage().classList.contains('ink-drawing')).toBe(false);
    expect(modes).toEqual([true, false]);
  });

  it('uses a mutually exclusive Erase switch and removes touched strokes', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    await drawStroke(ctx, [{ x: 0, y: 0 }, { x: 30, y: 20 }]);
    expect(strokes(ctx)).toHaveLength(1);

    expect(runCommand(ctx, 'ink.erase.toggle')).toBe(true);
    await settle();
    expect(stage().classList.contains('ink-drawing')).toBe(false);
    expect(stage().classList.contains('ink-erasing')).toBe(true);
    expect(document.querySelector('[data-command="ink.toggle"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-command="ink.erase.toggle"]')?.getAttribute('aria-pressed')).toBe('true');

    ctx.bus.emit('ink.item.erase', { kind: 'ink', id: strokes(ctx)[0].id });
    await settle();
    expect(strokes(ctx)).toHaveLength(0);

    expect(runCommand(ctx, 'history.undo')).toBe(true);
    await settle();
    expect(strokes(ctx)).toHaveLength(1);
  });

  it('erases nodes, edges, and containers through the same item command', async () => {
    const ctx = bootApp({ autoLayout: false });
    await settle();
    const a = ctx.graphs.current.createNode({ Label: { text: 'A' } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'B' } });
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    runCommand(ctx, 'editing.container.create');
    await settle();
    const edge = ctx.graphs.current.edges()[0];
    const container = ctx.graphs.current.itemsOfKind<{ id: string }>('container')[0];

    runCommand(ctx, 'ink.erase.toggle');
    ctx.bus.emit('ink.item.erase', { kind: 'edge', id: edge.id });
    ctx.bus.emit('ink.item.erase', { kind: 'node', id: a.id });
    ctx.bus.emit('ink.item.erase', { kind: 'container', id: container.id });
    await settle();

    expect(ctx.graphs.current.getEdge(edge.id)).toBeUndefined();
    expect(ctx.graphs.current.getNode(a.id)).toBeUndefined();
    expect(ctx.graphs.current.getNode(b.id)).toBeDefined();
    expect(ctx.graphs.current.itemsOfKind('container')).toHaveLength(0);
  });

  it('selects all drawings as one explicit action', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    await drawStroke(ctx, [{ x: 0, y: 0 }, { x: 30, y: 20 }]);
    await drawStroke(ctx, [{ x: 50, y: 0 }, { x: 80, y: 20 }]);

    expect(runCommand(ctx, 'ink.select.all')).toBe(true);
    expect(ctx.selection.selectedAll()).toEqual([
      { kind: 'ink', id: 'k1' },
      { kind: 'ink', id: 'k2' },
    ]);
  });

  it('draws a stroke: points accumulate, bounds derive, and the path renders', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    await settle();

    await drawStroke(ctx, [{ x: 10, y: 10 }, { x: 60, y: 20 }, { x: 110, y: 80 }]);

    const [stroke] = strokes(ctx);
    expect(stroke).toBeDefined();
    expect(stroke.Points).toHaveLength(3);
    expect(stroke.Color).toBe('pink');
    expect(stroke.Opacity).toBe(1);
    expect(stroke.Position).toEqual({ x: 60, y: 45 });
    expect(stroke.Size).toEqual({ w: 100, h: 70 });

    const path = document.querySelector<SVGPathElement>(`.ink-path[data-item-id="${stroke.id}"]`);
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')).toContain('Q 60 20');
  });

  it('uses armed draw color, width, and opacity and round-trips them', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    runCommand(ctx, 'ink.arm.color.blue');
    runCommand(ctx, 'ink.arm.width.6');
    runCommand(ctx, 'ink.arm.opacity.50');
    await settle();
    expect(document.querySelector('.palette-draw')).not.toBeNull();

    await drawStroke(ctx, [{ x: 0, y: 0 }, { x: 30, y: 20 }]);
    const [stroke] = strokes(ctx);
    expect(stroke).toMatchObject({ Color: 'blue', Width: 6, Opacity: 0.5 });
    expect(document.querySelector<SVGGElement>('.ink')?.style.opacity).toBe('0.5');

    const snapshot = ctx.graphs.current.snapshot();
    ctx.graphs.current.replace(snapshot);
    await settle();
    expect(strokes(ctx)[0]).toMatchObject({ Color: 'blue', Width: 6, Opacity: 0.5 });
  });

  it('drops a click that never moved (no dot annotations)', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    await settle();
    await drawStroke(ctx, [{ x: 5, y: 5 }]);
    expect(strokes(ctx)).toHaveLength(0);
  });

  it('ignores the gesture entirely while draw mode is off', async () => {
    const ctx = bootApp();
    await settle();
    await drawStroke(ctx, [{ x: 0, y: 0 }, { x: 50, y: 50 }]);
    expect(strokes(ctx)).toHaveLength(0);
  });

  it('recolors and rewidths a stroke via item.update, and deletes via selection', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    await settle();
    await drawStroke(ctx, [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }]);
    const [stroke] = strokes(ctx);

    ctx.bus.emit('item.update', { ref: { kind: 'ink', id: stroke.id }, patch: { Color: 'green', Width: 6 } });
    await settle();
    expect(strokes(ctx)[0].Color).toBe('green');
    expect(strokes(ctx)[0].Width).toBe(6);
    expect(document.querySelector(`.ink[data-ink-color="green"]`)).not.toBeNull();

    runCommand(ctx, 'ink.toggle'); // exit draw mode so selection acts normally
    await settle();
    ctx.selection.select({ kind: 'ink', id: stroke.id });
    ctx.bus.emit('selection.item.delete');
    await settle();
    expect(strokes(ctx)).toHaveLength(0);
    expect(document.querySelector('.ink-path')).toBeNull();
  });

  it('round-trips strokes through the graph snapshot (ink extension)', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    await settle();
    await drawStroke(ctx, [{ x: 0, y: 0 }, { x: 30, y: 10 }, { x: 60, y: 0 }]);
    ctx.bus.emit('item.update', { ref: { kind: 'ink', id: strokes(ctx)[0].id }, patch: { Color: 'blue' } });
    await settle();

    const snapshot = ctx.graphs.current.snapshot();
    expect(snapshot.extensions?.ink).toBeDefined();
    ctx.graphs.current.replace(snapshot);
    await settle();
    const restored = strokes(ctx);
    expect(restored).toHaveLength(1);
    expect(restored[0].Points).toHaveLength(3);
    expect(restored[0].Color).toBe('blue');
    expect(restored[0].Size).toEqual({ w: 60, h: 10 });
  });
});
