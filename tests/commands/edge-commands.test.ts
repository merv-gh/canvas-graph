import { describe, expect, it } from 'vitest';
import { bootV2, commandButton, modalText, runCommand, settle } from './v2-testkit';
import type { GraphNode } from '../../v2/model';

/** Edge creation is driven by `commandPicker` now — keyboard letter overlays
 *  for source/target, not a modal form. These tests exercise the picker path. */

const createNode = (ctx: ReturnType<typeof bootV2>, text: string): GraphNode =>
  ctx.graphs.current.createNode({ Label: { text } });

const captureInput = () =>
  document.querySelector<HTMLInputElement>('input[data-keyboard-mode="commandPicker"]');

const pressLetter = (letter: string) =>
  captureInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true, cancelable: true }));

describe('v2 edge commands (picker-driven)', () => {
  it('emits a notice when nothing is pickable for a step', async () => {
    const ctx = bootV2();
    createNode(ctx, 'lonely');
    ctx.bus.emit('selection.item.clear');
    await settle();
    expect(runCommand(ctx, 'editing.edge.create')).toBe(true);
    await settle();
    // The "To" step has zero candidates (only one node, From excludes it).
    // After picking From, the picker cancels with a notice.
    pressLetter('a');
    await settle();
    expect(document.querySelector('.log-row')?.textContent).toContain('Nothing to pick');
    expect(captureInput()).toBeNull();
  });

  it('seeds From from selection and picks To via letter — 2 keystrokes', async () => {
    const ctx = bootV2();
    const source = createNode(ctx, 'A');
    const target = createNode(ctx, 'B');
    ctx.bus.emit('selection.node.select', { id: source.id });
    await settle();

    runCommand(ctx, 'editing.edge.create');
    await settle();
    pressLetter('a');
    await settle();

    expect(ctx.graphs.current.edges()).toHaveLength(1);
    const edge = ctx.graphs.current.edges()[0];
    expect(edge.From).toBe(source.id);
    expect(edge.To).toBe(target.id);
  });

  it('picks both endpoints when no selection — 3 keystrokes', async () => {
    const ctx = bootV2();
    const a = createNode(ctx, 'A');
    const b = createNode(ctx, 'B');
    ctx.bus.emit('selection.item.clear');
    await settle();

    runCommand(ctx, 'editing.edge.create');
    await settle();
    pressLetter('a');  // pick A as From
    await settle();
    // After From picked, only B is a valid To candidate
    expect([...document.querySelectorAll('.picker-letter')]).toHaveLength(1);
    pressLetter('a');  // pick B as To
    await settle();

    expect(ctx.graphs.current.edges()).toHaveLength(1);
    const edge = ctx.graphs.current.edges()[0];
    expect(edge.From).toBe(a.id);
    expect(edge.To).toBe(b.id);
  });

  it('filter excludes the From node from the To step', async () => {
    const ctx = bootV2();
    createNode(ctx, 'A');
    createNode(ctx, 'B');
    createNode(ctx, 'C');
    ctx.bus.emit('selection.item.clear');
    await settle();

    runCommand(ctx, 'editing.edge.create');
    await settle();
    pressLetter('a');  // From = first
    await settle();
    expect([...document.querySelectorAll('.picker-letter')]).toHaveLength(2);
  });

  it('Escape cancels picker without creating an edge', async () => {
    const ctx = bootV2();
    createNode(ctx, 'A');
    createNode(ctx, 'B');
    ctx.bus.emit('selection.item.clear');
    await settle();
    runCommand(ctx, 'editing.edge.create');
    await settle();
    expect(captureInput()).not.toBeNull();
    captureInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(captureInput()).toBeNull();
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });

  it('keeps a form open when form payload cannot be built (form path still supported)', () => {
    const ctx = bootV2();
    ctx.contexts.commands.register([{
      id: 'test.null-form',
      label: 'Null form command',
      event: 'app.notice',
      group: 'test',
      origin: 'test',
      form: {
        fields: [],
        shouldOpen: () => true,
        payload: () => undefined,
      },
    }]);

    expect(runCommand(ctx, 'test.null-form')).toBe(true);
    expect(runCommand(ctx, 'commandForm.submit', { target: commandButton('commandForm.submit') })).toBe(true);
    expect(document.querySelector('.form-error')?.textContent).toBe('Fill the required fields.');
    expect(document.querySelector('.modal-layer')).not.toBeNull();
  });

  it('updates, opens properties for, and deletes an edge', () => {
    const ctx = bootV2();
    const source = createNode(ctx, 'A');
    const target = createNode(ctx, 'B');
    ctx.bus.emit('graph.edge.create', { From: source.id, To: target.id });
    const edge = ctx.graphs.current.edges()[0];

    ctx.bus.emit('graph.edge.update', { id: edge.id, patch: { Label: { text: 'depends' } } });
    expect(edge.Label?.text).toBe('depends');

    const fakeRow = document.createElement('button');
    fakeRow.dataset.itemKind = 'edge';
    fakeRow.dataset.itemId = edge.id;
    expect(runCommand(ctx, 'item.properties.open', { target: fakeRow })).toBe(true);
    expect(modalText()).toContain('Edge Properties');
    const label = document.querySelector<HTMLInputElement>('.properties [data-field="label"]')!;
    label.value = 'blocks';
    expect(runCommand(ctx, 'properties.item.input', { target: label })).toBe(true);
    expect(edge.Label?.text).toBe('blocks');

    expect(runCommand(ctx, 'graph.edge.delete', { target: fakeRow })).toBe(true);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });

  it('deletes a selected edge from command or X shortcut', async () => {
    const ctx = bootV2();
    const source = createNode(ctx, 'A');
    const target = createNode(ctx, 'B');
    ctx.bus.emit('graph.edge.create', { From: source.id, To: target.id });
    let edge = ctx.graphs.current.edges()[0];

    ctx.bus.emit('selection.item.select', { kind: 'edge', id: edge.id });
    expect(runCommand(ctx, 'graph.edge.delete')).toBe(true);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(ctx.selection.selected()).toBeNull();

    ctx.bus.emit('graph.edge.create', { From: source.id, To: target.id });
    edge = ctx.graphs.current.edges()[0];
    ctx.bus.emit('selection.item.select', { kind: 'edge', id: edge.id });
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(ctx.selection.selected()).toBeNull();
  });
});
