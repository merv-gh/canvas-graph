import { describe, expect, it } from 'vitest';
import { bootApp, commandButton, field, runCommand, settle } from './testkit';
import type { Container } from '../../frontend/systems/container-entity';

/** End-to-end regression for the architecture-diagram journey: recreate a
 *  Kimi-style subset through the same commands the UI dispatches — preset,
 *  chained node creation (preset defaults for type AND edge kind), palette
 *  type/color, letter-picked edge selection + kind, search-based grouping,
 *  legend + multiplier. The true keyboard-only browser flow lives in
 *  tests/architecture-preset.spec.js; this is its fast jsdom twin. */

const captureInput = () =>
  document.querySelector<HTMLInputElement>('input[data-keyboard-mode="commandPicker"]');
const pressLetter = (letter: string) =>
  captureInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true, cancelable: true }));
const click = (el: HTMLElement) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('architecture diagram journey', () => {
  it('recreates a Kimi-style subset via commands only', async () => {
    const ctx = bootApp();
    await settle();
    const nodes = () => ctx.graphs.current.nodes();
    const byLabel = (text: string) => nodes().find(node => node.Label.text === text)!;

    // 1. Architecture preset on (dark canvas, vertical layout, dense default
    //    node type, plain default edge kind).
    ctx.bus.emit('preset.set', { preset: 'architecture' });
    await settle();
    expect(document.querySelector('.shell')?.getAttribute('data-preset')).toBe('architecture');

    // 2. Four blocks with `A` (vertical mode stacks them; preset supplies the
    //    dense default type), then wire the chain — created without an explicit
    //    kind, so the preset's plain default applies.
    const labels = ['MLA · attention', 'Expert router', 'Shared expert', 'Routed experts'];
    for (const label of labels) {
      runCommand(ctx, 'editing.node.create');
      await settle();
      const id = ctx.selection.selectedNode()!.id;
      ctx.bus.emit('item.update', { ref: { kind: 'node', id }, patch: { Label: { text: label } } });
      await settle();
      ctx.bus.emit('selection.item.clear');
      await settle();
    }
    expect(nodes()).toHaveLength(4);
    expect(nodes().every(node => node.NodeType === 'dense')).toBe(true);

    ctx.bus.emit('graph.edge.create', { From: byLabel('MLA · attention').id, To: byLabel('Expert router').id });
    ctx.bus.emit('graph.edge.create', { From: byLabel('Expert router').id, To: byLabel('Shared expert').id });
    ctx.bus.emit('graph.edge.create', { From: byLabel('Expert router').id, To: byLabel('Routed experts').id });
    await settle();
    expect(ctx.graphs.current.edges()).toHaveLength(3);
    expect(ctx.graphs.current.edges().every(edge => edge.EdgeKind === 'plain')).toBe(true);

    // 3. Retype + tint via the palette commands.
    ctx.selection.select({ kind: 'node', id: byLabel('MLA · attention').id });
    await settle();
    expect(runCommand(ctx, 'node.type.attention')).toBe(true);
    expect(runCommand(ctx, 'node.color.red')).toBe(true);
    ctx.selection.select({ kind: 'node', id: byLabel('Routed experts').id });
    await settle();
    expect(runCommand(ctx, 'node.type.moe')).toBe(true);
    expect(runCommand(ctx, 'node.color.orange')).toBe(true);
    await settle();
    expect(byLabel('MLA · attention').NodeType).toBe('attention');
    expect(byLabel('MLA · attention').Color).toBe('red');
    expect(byLabel('Routed experts').NodeType).toBe('moe');

    // 4. An ⊕ operator and a caption.
    ctx.selection.select({ kind: 'node', id: byLabel('Routed experts').id });
    runCommand(ctx, 'editing.node.create');
    await settle();
    const opId = ctx.selection.selectedNode()!.id;
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: opId }, patch: { Label: { text: '⊕' } } });
    expect(runCommand(ctx, 'node.type.operator')).toBe(true);
    await settle();
    expect(byLabel('⊕').NodeType).toBe('operator');
    expect(byLabel('⊕').Size).toEqual({ w: 44, h: 44 });

    ctx.bus.emit('selection.item.clear');
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const captionId = ctx.selection.selectedNode()!.id;
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: captionId }, patch: { Label: { text: 'Kimi K3 architecture' } } });
    expect(runCommand(ctx, 'node.type.caption')).toBe(true);
    await settle();
    expect(byLabel('Kimi K3 architecture').NodeType).toBe('caption');

    // 5. Restyle one chain edge to dashed: letter-pick it, then set the kind.
    const routerToRouted = ctx.graphs.current.edges()
      .find(edge => edge.From === byLabel('Expert router').id && edge.To === byLabel('Routed experts').id)!;
    expect(runCommand(ctx, 'edge.select')).toBe(true);
    await settle();
    const edgeOverlay = [...document.querySelectorAll<HTMLElement>('.picker-letter')]
      .find(el => el.closest('[data-item-id]')?.getAttribute('data-item-id') === routerToRouted.id)
      ?? [...document.querySelectorAll<HTMLElement>('.item-overlay')]
        .find(el => el.dataset.itemId === routerToRouted.id);
    // Overlay letters render as text; find the letter bound to our edge via
    // the decorations overlay map exposed in the DOM.
    const overlays = [...document.querySelectorAll<HTMLElement>('.picker-letter, .item-overlay')];
    const target = overlays.find(el =>
      (el.dataset.itemId ?? el.closest('[data-item-id]')?.getAttribute('data-item-id')) === routerToRouted.id)
      ?? edgeOverlay;
    expect(target, 'picker overlay for the router→routed edge').toBeDefined();
    pressLetter(target!.textContent!.trim().toLowerCase());
    await settle();
    expect(ctx.selection.selected()).toEqual(expect.objectContaining({ kind: 'edge', id: routerToRouted.id }));
    expect(runCommand(ctx, 'edge.kind.dashed')).toBe(true);
    await settle();
    expect(ctx.graphs.current.getEdge(routerToRouted.id)?.EdgeKind).toBe('dashed');

    // 6. Group the expert nodes by search, then badge the group.
    expect(runCommand(ctx, 'choose.search')).toBe(true);
    await settle();
    field('q')!.value = 'expert';
    click(commandButton('commandForm.submit')!);
    await settle();
    expect(ctx.selection.selectedAll().length).toBeGreaterThanOrEqual(3);
    expect(runCommand(ctx, 'selection.group')).toBe(true);
    await settle();
    const container = ctx.graphs.current.itemsOfKind<Container>('container')[0];
    expect(container).toBeDefined();
    expect(container.Children.length).toBeGreaterThanOrEqual(3);

    ctx.bus.emit('item.update', {
      ref: { kind: 'container', id: container.id },
      patch: {
        Legend: [
          { color: 'blue', label: 'Shared expert' },
          { color: 'orange', label: 'Routed experts' },
        ],
        Multiplier: '60×',
      },
    });
    await settle();
    expect(container.Legend).toHaveLength(2);
    expect(document.querySelector('.container-multiplier')?.textContent).toBe('60×');

    // 7. The whole document round-trips (nodes, kinds, container extras).
    const snapshot = ctx.graphs.current.snapshot();
    ctx.graphs.current.replace(snapshot);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(6);
    expect(ctx.graphs.current.getEdge(routerToRouted.id)?.EdgeKind).toBe('dashed');
    expect(ctx.graphs.current.itemsOfKind<Container>('container')[0].Multiplier).toBe('60×');
  });
});
