import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import type { AppCtx } from '../../frontend/core';

/** Direct manipulation on the canvas: drag a card by its body, rename an edge
 *  by double-clicking its label, and keep global shortcuts out of an inline
 *  editor. All three go through the real DOM → input router → command path,
 *  because the bug in each case was the routing, not the handler. */

const pointer = (type: string, x: number, y: number, target: Element) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true }));

const key = (target: Element, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, key: k, ...init }));

const nodeEl = (id: string) =>
  document.querySelector<HTMLElement>(`.node[data-item-id="${id}"]`)!;

const twoConnectedNodes = async (ctx: AppCtx) => {
  runCommand(ctx, 'editing.node.create');
  await settle();
  runCommand(ctx, 'editing.node.create');
  await settle();
  const [from, to] = ctx.graphs.current.nodes();
  ctx.bus.emit('graph.edge.create', { from: from.id, to: to.id });
  await settle();
  return ctx.graphs.current.edges()[0];
};

describe('drag a node by its body', () => {
  it('moves the node and still selects it on the same press', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const before = { ...node.Position! };
    const el = nodeEl(node.id);
    expect(el.hasAttribute('data-drag-surface')).toBe(true);

    pointer('pointerdown', 10, 10, el);
    pointer('pointermove', 90, 60, document.body);
    await settle();
    pointer('pointerup', 90, 60, document.body);
    await settle();

    expect(node.Position!.x).toBeGreaterThan(before.x);
    expect(node.Position!.y).toBeGreaterThan(before.y);
    // Selectable runs after draggable on the same pointerdown — picking the
    // card must not cost a second click.
    expect(ctx.selection.selected()).toEqual({ kind: 'node', id: node.id });
  });

  it('ignores jitter below the drag threshold so clicks stay clicks', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const before = { ...node.Position! };
    const el = nodeEl(node.id);

    pointer('pointerdown', 40, 40, el);
    pointer('pointermove', 42, 41, el);
    await settle();
    pointer('pointerup', 42, 41, el);
    await settle();

    expect(node.Position).toEqual(before);
  });

  it('treats a press with no movement as a plain click, not a drop', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const before = { ...node.Position! };
    const updates: unknown[] = [];
    ctx.bus.on('item.update', patch => updates.push(patch));

    const el = nodeEl(node.id);
    pointer('pointerdown', 10, 10, el);
    pointer('pointerup', 10, 10, el);
    await settle();

    expect(node.Position).toEqual(before);
    expect(updates).toHaveLength(0);
  });

  it('does not start a drag from chrome that owns its own gesture', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const before = { ...node.Position! };
    const title = nodeEl(node.id).querySelector<HTMLElement>('[data-editable-title]')!;
    title.classList.add('editing');

    pointer('pointerdown', 10, 10, title);
    pointer('pointermove', 90, 60, document.body);
    await settle();
    pointer('pointerup', 90, 60, document.body);
    await settle();

    expect(node.Position).toEqual(before);
  });
});

describe('the ability contract is checked, not assumed', () => {
  it('boots clean', async () => {
    const ctx = bootApp();
    await settle();
    expect(ctx.dx!.run().filter(issue => issue.rule === 'ability.unrendered')).toEqual([]);
  });

  it('warns when a declared ability has nothing rendered to drive it', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    // Exactly the shape node cards shipped in: declared draggable, with no
    // surface to drag. Silent before this rule existed.
    document.querySelectorAll('[data-drag-surface]').forEach(el => el.removeAttribute('data-drag-surface'));

    const issues = ctx.dx!.run().filter(issue => issue.rule === 'ability.unrendered');
    expect(issues.map(issue => issue.message).join('\n')).toContain('node');
    expect(issues.map(issue => issue.message).join('\n')).toContain('draggable');
  });
});

describe('edge labels', () => {
  it('renders an editable label host for every edge, empty ones included', async () => {
    const ctx = bootApp();
    const edge = await twoConnectedNodes(ctx);
    const host = document.querySelector(`.edge-label-host[data-item-id="${edge.id}"]`);
    expect(host).not.toBeNull();
    const label = host!.querySelector('[data-editable-title]');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('');
    expect(document.querySelector('.edge-label-wrap.is-empty')).not.toBeNull();
  });

  it('double-clicking the label edits it and commits on Enter', async () => {
    const ctx = bootApp();
    const edge = await twoConnectedNodes(ctx);
    const label = () => document.querySelector<HTMLElement>(`.edge-label-host[data-item-id="${edge.id}"] [data-editable-title]`)!;

    label().dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await settle();
    expect(label().classList.contains('editing')).toBe(true);

    label().textContent = 'publishes to';
    key(label(), 'Enter');
    await settle();

    expect(ctx.graphs.current.getEdge(edge.id)!.Label?.text).toBe('publishes to');
  });

  it('renames the selected edge from the keyboard too', async () => {
    const ctx = bootApp();
    const edge = await twoConnectedNodes(ctx);
    ctx.bus.emit('selection.item.select', { kind: 'edge', id: edge.id });
    await settle();

    expect(runCommand(ctx, 'item.title.edit')).toBe(true);
    await settle();
    const label = document.querySelector<HTMLElement>(`.edge-label-host[data-item-id="${edge.id}"] [data-editable-title]`)!;
    expect(label.classList.contains('editing')).toBe(true);
  });
});

describe('inline editing owns the keyboard', () => {
  const startRename = async (ctx: AppCtx) => {
    const node = ctx.graphs.current.nodes()[0];
    ctx.bus.emit('selection.item.select', { kind: 'node', id: node.id });
    await settle();
    runCommand(ctx, 'item.title.edit');
    await settle();
    const title = nodeEl(node.id).querySelector<HTMLElement>('[data-editable-title]')!;
    expect(title.classList.contains('editing')).toBe(true);
    title.focus();
    return { node, title };
  };

  it('swallows graph shortcuts while a title is being edited', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const { title } = await startRename(ctx);
    const before = ctx.graphs.current.nodes().length;

    // Retargeted at <body>: this is exactly what a redraw used to do, and it
    // is what made `a`/`x` fire in the middle of a rename.
    ['a', 'x', 'c', 't'].forEach(k => key(document.body, k));
    await settle();

    expect(ctx.graphs.current.nodes()).toHaveLength(before);
    expect(title.classList.contains('editing')).toBe(true);
  });

  it('still lets Escape and the commit bindings through', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const { node, title } = await startRename(ctx);

    title.textContent = 'Checkout';
    key(title, 'Enter');
    await settle();
    expect(ctx.graphs.current.getNode(node.id)!.Label.text).toBe('Checkout');
    // Session over → shortcuts are live again.
    key(document.body, 'a');
    await settle();
    expect(ctx.graphs.current.nodes().length).toBeGreaterThan(1);
  });

  it('Escape puts the original text back instead of committing it', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const { node, title } = await startRename(ctx);
    const original = ctx.graphs.current.getNode(node.id)!.Label.text;

    title.textContent = 'typed but abandoned';
    ctx.bus.emit('app.cancel', { source: 'escape' });
    await settle();

    expect(ctx.graphs.current.getNode(node.id)!.Label.text).toBe(original);
    expect(document.querySelector('.node [data-editable-title]')!.textContent).toBe(original);
    expect(document.querySelector('.node [data-editable-title].editing')).toBeNull();
    // Session over → the keyboard belongs to the canvas again.
    key(document.body, 'a');
    await settle();
    expect(ctx.graphs.current.nodes().length).toBeGreaterThan(1);
  });

  it('a stage redraw does not tear the caret out of the editor', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const { title } = await startRename(ctx);
    title.textContent = 'half typed';

    ctx.bus.emit('render.stage.draw', { full: true });
    await settle();

    const live = document.querySelector<HTMLElement>('.node [data-editable-title].editing');
    expect(live).toBe(title);
    expect(live!.textContent).toBe('half typed');
  });

  it('a full draw reuses unchanged elements instead of rebuilding the world', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    const before = nodeEl(node.id);

    ctx.bus.emit('render.stage.draw', { full: true });
    await settle();
    expect(nodeEl(node.id)).toBe(before);

    // …and still redraws the ones that actually changed.
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: node.id }, patch: { Label: { text: 'Renamed' } } });
    await settle();
    expect(nodeEl(node.id).textContent).toContain('Renamed');
  });
});
