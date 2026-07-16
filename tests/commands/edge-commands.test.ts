import { describe, expect, it } from 'vitest';
import { bootApp, commandButton, modalText, runCommand, settle } from './testkit';
import type { GraphNode } from '../../frontend/model';

/** Edge creation is driven by `commandPicker` now — keyboard letter overlays
 *  for source/target, not a modal form. These tests exercise the picker path. */

const createNode = (ctx: ReturnType<typeof bootApp>, text: string): GraphNode =>
  ctx.graphs.current.createNode({ Label: { text } });

const captureInput = () =>
  document.querySelector<HTMLInputElement>('input[data-keyboard-mode="commandPicker"]');

const pressLetter = (letter: string) =>
  captureInput()!.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true, cancelable: true }));

describe('frontend edge commands (picker-driven)', () => {
  it('accepts pointer clicks on visible candidates and confirms completion', async () => {
    const ctx = bootApp({ autoLayout: false });
    await settle();
    runCommand(ctx, 'editing.node.create');
    ctx.bus.emit('selection.item.clear');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const [source, target] = ctx.graphs.current.nodes();
    const baseline = ctx.graphs.current.edges().length;
    ctx.bus.emit('selection.node.select', { id: source.id });
    await settle();
    runCommand(ctx, 'editing.edge.create');
    await settle();
    document.querySelector<HTMLElement>(`.node[data-item-id="${target.id}"]`)!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.edges()).toHaveLength(baseline + 1);
    expect(document.querySelector('.app-notice')?.textContent).toBe('Edge created.');
  });

  it('emits a notice when nothing is pickable for a step', async () => {
    const ctx = bootApp();
    createNode(ctx, 'lonely');
    ctx.bus.emit('selection.item.clear');
    await settle();
    expect(runCommand(ctx, 'editing.edge.create')).toBe(true);
    await settle();
    // The "To" step has zero candidates (only one node, From excludes it).
    // After picking From, the picker cancels with a notice.
    pressLetter('a');
    await settle();
    // Log rendering disconnected; verify via bus instead.
    expect(ctx.bus['_emitted'].has('app.notice')).toBe(true);
    expect(captureInput()).toBeNull();
  });

  it('seeds From from selection and picks To via letter — 2 keystrokes', async () => {
    const ctx = bootApp();
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
    const ctx = bootApp();
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
    const ctx = bootApp();
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
    const ctx = bootApp();
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

  it('cancels the active picker when switching graphs or opening a modal', async () => {
    const ctx = bootApp();
    createNode(ctx, 'A');
    createNode(ctx, 'B');
    ctx.bus.emit('selection.item.clear');
    await settle();
    runCommand(ctx, 'editing.edge.create');
    await settle();
    expect(captureInput()).not.toBeNull();

    runCommand(ctx, 'graph.create');
    await settle();
    expect(captureInput()).toBeNull();
    expect(document.querySelector('.picker-prompt')).toBeNull();

    createNode(ctx, 'C');
    createNode(ctx, 'D');
    ctx.bus.emit('selection.item.clear');
    runCommand(ctx, 'editing.edge.create');
    await settle();
    expect(captureInput()).not.toBeNull();
    ctx.bus.emit('modal.open', { title: 'Other task', body: () => document.createElement('p') });
    await settle();
    expect(captureInput()).toBeNull();
    expect(document.querySelector('.picker-prompt')).toBeNull();
  });

  it('keeps a form open when form payload cannot be built (form path still supported)', () => {
    const ctx = bootApp();
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
    const ctx = bootApp();
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
    const label = document.querySelector<HTMLInputElement>('[data-item-modal-title]')!;
    expect(label.value).toBe('depends');
    label.value = 'blocks';
    expect(runCommand(ctx, 'properties.title.input', { target: label })).toBe(true);
    expect(edge.Label?.text).toBe('blocks');
    expect(document.querySelector('.properties [data-field="label"]')).toBeNull();

    expect(runCommand(ctx, 'graph.edge.delete', { target: fakeRow })).toBe(true);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });

  it('surfaces edge editing beside a selected connection', async () => {
    const ctx = bootApp();
    const source = createNode(ctx, 'A');
    const target = createNode(ctx, 'B');
    ctx.bus.emit('graph.edge.create', { From: source.id, To: target.id, Label: { text: 'calls' } });
    const edge = ctx.graphs.current.edges()[0];
    ctx.bus.emit('selection.item.select', { kind: 'edge', id: edge.id });
    await settle();

    const edit = document.querySelector<HTMLElement>('.item-toolbar [data-command="item.properties.open"]');
    expect(edit).not.toBeNull();
    expect(edit?.getAttribute('aria-label')).toContain('Edit');
    expect(runCommand(ctx, 'item.properties.open', { target: edit })).toBe(true);
    await settle();
    expect(document.querySelector('.context-actions')?.textContent).toContain('Reverse direction');
    expect(document.querySelector('.context-actions')?.textContent).toContain('Delete connection');
    expect(document.querySelectorAll('.property-advanced-group')).toHaveLength(0);
    expect(document.querySelector('.properties-autosave-note')?.textContent).toContain('save automatically');
  });

  it('deletes a selected edge from command or X shortcut', async () => {
    const ctx = bootApp();
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
