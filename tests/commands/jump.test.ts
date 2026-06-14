import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

const LETTERS = 'asdfghjklqwertyuiopzxcvbnm';

const captureInput = () =>
  document.querySelector<HTMLInputElement>('input[data-keyboard-mode="jump"]');

const overlay = (letter: string) =>
  document.querySelector(`[data-overlay-id="jump-${letter}"]`);

describe('jump system (single-file vimium-style mode)', () => {
  it('renders one letter overlay per focusable item on start', async () => {
    const ctx = bootApp();
    const a = ctx.graphs.current.node({ Label: { text: 'A' } });
    const b = ctx.graphs.current.node({ Label: { text: 'B' } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: a.id });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: b.id });
    await settle();

    runCommand(ctx, 'jump.start');
    await settle();

    expect(captureInput()).not.toBeNull();
    const letters = [...document.querySelectorAll('.jump-letter')].map(el => el.textContent);
    expect(letters).toEqual([LETTERS[0].toUpperCase(), LETTERS[1].toUpperCase()]);
    expect(overlay(LETTERS[0])).not.toBeNull();
  });

  it('focuses the matching item and fits view on letter press', async () => {
    const ctx = bootApp();
    const a = ctx.graphs.current.node({ Label: { text: 'A' } });
    const b = ctx.graphs.current.node({ Label: { text: 'B' } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: a.id });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: b.id });
    await settle();

    runCommand(ctx, 'jump.start');
    await settle();
    const input = captureInput()!;

    const fitCalls: unknown[] = [];
    ctx.bus.on('view.fit.item', ref => fitCalls.push(ref));

    input.dispatchEvent(new KeyboardEvent('keydown', { key: LETTERS[1], bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.focused()).toEqual({ kind: 'node', id: b.id });
    expect(fitCalls).toEqual([{ kind: 'node', id: b.id }]);
    expect(captureInput()).toBeNull();
    expect(document.querySelector('.jump-letter')).toBeNull();
  });

  it('escape cancels without focusing anything', async () => {
    const ctx = bootApp();
    const a = ctx.graphs.current.node({ Label: { text: 'A' } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: a.id });
    await settle();
    const beforeFocus = ctx.selection.focused();

    runCommand(ctx, 'jump.start');
    await settle();
    const input = captureInput()!;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.focused()).toEqual(beforeFocus);
    expect(captureInput()).toBeNull();
    expect(document.querySelector('.jump-letter')).toBeNull();
  });

  it('unmapped letters cancel jump mode', async () => {
    const ctx = bootApp();
    const a = ctx.graphs.current.node({ Label: { text: 'A' } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: a.id });
    await settle();

    runCommand(ctx, 'jump.start');
    await settle();
    const input = captureInput()!;

    // 'z' is way past the only assigned letter ('a') so it should cancel cleanly.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
    await settle();

    expect(captureInput()).toBeNull();
  });

  it('targets edges as well as nodes', async () => {
    const ctx = bootApp();
    const a = ctx.graphs.current.node({ Label: { text: 'A' }, Position: { x: 0, y: 0 } });
    const b = ctx.graphs.current.node({ Label: { text: 'B' }, Position: { x: 200, y: 0 } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: a.id });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: b.id });
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    await settle();

    runCommand(ctx, 'jump.start');
    await settle();

    expect(document.querySelectorAll('.jump-letter')).toHaveLength(3);
    const edge = ctx.graphs.current.edges()[0];
    const edgeOverlay = document.querySelector(`[data-item-kind="edge"][data-item-id="${edge.id}"].item-overlay`);
    expect(edgeOverlay).not.toBeNull();
  });
});
