import { describe, expect, it } from 'vitest';
import {
  commandShortcut,
  collectionCreateCommand,
  collectionDeleteCommand,
  collectionKind,
  collectionSelectCommand,
  edgeRef,
  grouped,
  itemRefFrom,
  memoryIo,
  nodeRect,
  parseShortcut,
  shortcutOf,
  tagItem,
} from '../../frontend/core';
import { Graph, graphStore } from '../../frontend/model';
import type { CommandSpec } from '../../frontend/types';
import { bootApp, runCommand, settle } from './testkit';

declare module '../../frontend/types' {
  interface CustomItemKinds {
    container: unknown;
  }
}

describe('frontend selection polymorphism', () => {
  it('holds an ItemRef of any kind, with typed node/edge projections', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await new Promise(r => setTimeout(r, 0));
    const [a, b] = ctx.graphs.current.nodes();
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    const edge = ctx.graphs.current.edges()[0];

    // Default selection after creation is node
    expect(ctx.selection.selected()?.kind).toBe('node');
    expect(ctx.selection.selectedNode()?.id).toBe(b.id);

    // Polymorphic store accepts edge selection — even though no ability exposes it yet
    ctx.selection.select({ kind: 'edge', id: edge.id });
    expect(ctx.selection.selected()).toEqual({ kind: 'edge', id: edge.id });
    expect(ctx.selection.selectedNode()).toBeUndefined();

    // Deleting the edge clears the selection
    ctx.bus.emit('graph.edge.delete', { id: edge.id });
    expect(ctx.selection.selected()).toBeNull();
  });

  it('focuses and highlights any ItemRef through item modes', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const [a, b] = ctx.graphs.current.nodes();
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    await settle();
    const ref = edgeRef(ctx.graphs.current.edges()[0].id);

    ctx.bus.emit('focus.item.focus', ref);
    await settle();

    expect(ctx.selection.focused()).toEqual(ref);
    expect(ctx.contexts.decorations.modes.has(ref, 'focused')).toBe(true);
    expect(document.querySelector(`.edge-line[data-item-kind="edge"][data-item-id="${ref.id}"]`)?.classList.contains('focused')).toBe(true);
    expect(document.activeElement?.getAttribute('data-item-kind')).toBe('edge');
    expect(document.activeElement?.getAttribute('data-item-id')).toBe(ref.id);
  });

  it('selects and focuses canvas edges through the generic item command', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const [a, b] = ctx.graphs.current.nodes();
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    await settle();
    const ref = edgeRef(ctx.graphs.current.edges()[0].id);

    document.querySelector(`.edge-hit[data-item-kind="edge"][data-item-id="${ref.id}"]`)!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.selected()).toEqual(ref);
    expect(ctx.selection.focused()).toEqual(ref);
    expect(document.querySelector(`.edge-line[data-item-kind="edge"][data-item-id="${ref.id}"]`)?.classList.contains('selected')).toBe(true);
    expect(document.querySelector(`.edge-line[data-item-kind="edge"][data-item-id="${ref.id}"]`)?.classList.contains('focused')).toBe(true);
    expect(document.activeElement?.getAttribute('data-item-kind')).toBe('edge');
    expect(document.activeElement?.getAttribute('data-item-id')).toBe(ref.id);
  });

  it('exposes ItemRef targets, overlays, and keyboard capture for future modes', async () => {
    const ctx = bootApp();
    // Direct create — smart-A (Principle 17) auto-attaches the second create
    // to the first, which adds an extra edge. This test only cares about the
    // targets surface, so go straight to the data layer.
    const a = ctx.graphs.current.createNode({ Label: { text: 'a' } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'b' } });
    ctx.bus.emit('graph.edge.create', { From: a.id, To: b.id });
    await settle();
    const edge = ctx.graphs.current.edges()[0];

    expect(ctx.contexts.hierarchy.targets().map(target => target.ref)).toEqual([
      { kind: 'node', id: a.id },
      { kind: 'node', id: b.id },
      { kind: 'edge', id: edge.id },
    ]);

    ctx.contexts.decorations.overlays.set('test', [{ ref: edgeRef(edge.id), text: 'AA' }]);
    await settle();
    const overlay = document.querySelector<HTMLElement>('.item-overlay')!;
    expect(overlay.textContent).toBe('AA');
    expect(overlay.dataset.itemKind).toBe('edge');
    expect(overlay.dataset.itemId).toBe(edge.id);

    const capture = ctx.contexts.keyboard.capture('jump');
    expect(ctx.contexts.keyboard.active()).toBe('jump');
    expect(document.activeElement).toBe(capture.input);
    capture.input.value = 'e';
    expect(capture.value()).toBe('e');
    capture.clear();
    expect(capture.value()).toBe('');
    capture.stop();
    expect(ctx.contexts.keyboard.active()).toBeNull();
    expect(document.querySelector('[data-keyboard-mode="jump"]')).toBeNull();
  });
});

describe('frontend model and core helpers', () => {
  it('creates nodes, edges, updates, deletes, and cascades incident edges', () => {
    const graph = Graph.new('g-test');
    const a = graph.createNode({ Label: { text: 'A' }, Position: { x: 10, y: 20 } });
    const b = graph.createNode({ Label: { text: 'B' } }, { nearPosition: a.Position });
    const edge = graph.createEdge({ From: a.id, To: b.id });

    expect(nodeRect(a)).toEqual({ x: -65, y: -12, w: 150, h: 64 });
    expect(graph.edgesOf(a.id)).toEqual([edge]);
    expect(graph.updateNode(a.id, { Label: { text: 'AA' } })).toBe(true);
    expect(graph.updateEdge(edge.id, { Label: { text: 'link' } })).toBe(true);
    expect(edge.Label?.text).toBe('link');
    expect(graph.getItem({ kind: 'node', id: a.id })).toBe(a);
    expect(graph.getItem({ kind: 'edge', id: edge.id })).toBe(edge);

    expect(graph.deleteNode(a.id)).toBe(true);
    expect(graph.edges()).toHaveLength(0);
    expect(graph.updateNode('missing', { Label: { text: 'x' } })).toBe(false);
    expect(graph.updateEdge('missing', { Label: { text: 'x' } })).toBe(false);
  });

  it('opens graph item stores and DOM refs for future container-like kinds', () => {
    const graph = Graph.new('g-test');
    const containers = [{ kind: 'container' as const, id: 'c1', parent: ['root'], title: 'Group' }];
    const stop = graph.registerItemStore('container', () => containers);

    expect(graph.itemsOfKind('container')).toEqual(containers);
    expect(graph.getItem({ kind: 'container', id: 'c1', parent: ['root'] })).toBe(containers[0]);
    expect(graph.getItem({ kind: 'container', id: 'c1' })).toBeUndefined();

    const el = document.createElement('button');
    tagItem(el, { kind: 'container', id: 'c1', parent: ['root'] });
    expect(el.dataset.itemParent).toBe('["root"]');
    expect(itemRefFrom(el)).toEqual({ kind: 'container', id: 'c1', parent: ['root'] });

    stop();
    expect(graph.itemsOfKind('container')).toEqual([]);
  });

  it('derives collection defaults and commands from collection kind', () => {
    const ctx = bootApp();
    const graphs = ctx.model.collection<Graph>('graphs')!;
    const nodes = ctx.model.collection<{ id: string; Label: { text: string } }>('nodes')!;
    const fake = { id: 'foos', label: 'Foos', items: () => [{ id: 'f1' }] };

    expect(collectionKind(fake)).toBe('foo');
    expect(graphs.itemLabel(ctx.graphs.current)).toBe(ctx.graphs.current.id);
    expect(nodes.itemLabel({ id: 'n1', Label: { text: 'Named' } })).toBe('Named');
    expect(collectionCreateCommand(graphs)).toBe('graph.create');
    expect(collectionDeleteCommand(graphs)).toBe('graph.delete');
    expect(collectionSelectCommand(graphs)).toBe('graph.switch');
    expect(collectionCreateCommand(nodes)).toBe('editing.node.create');
    expect(collectionDeleteCommand(nodes)).toBe('graph.node.delete');
    expect(collectionSelectCommand(nodes)).toBe('selection.item.select');
  });

  it('switches and deletes graphs while keeping a current graph', () => {
    const graphs = graphStore();
    const first = graphs.current;
    const second = graphs.create('g2');

    expect(graphs.switch(second.id)).toBe(second);
    expect(graphs.delete(second.id)).toBe(first);
    expect(graphs.current).toBe(first);
    expect(graphs.delete(first.id)).toBe(first);
  });

  it('parses shortcuts, groups items, resolves refs, and persists memory IO', () => {
    const parsed = parseShortcut('Ctrl+Shift+P');
    expect(parsed).toMatchObject({ key: 'P', ctrl: true, shift: true });

    const command = { id: 'x', label: 'X', event: 'app.start' as const, input: { on: 'keydown' as const, key: 'x', ctrl: true } };
    expect(shortcutOf(command)).toBe('Ctrl+x');
    expect(grouped(['a', 'ab', 'b'], item => item[0])).toEqual([['a', ['a', 'ab']], ['b', ['b']]]);

    const el = document.createElement('div');
    tagItem(el, { kind: 'edge', id: 'r1' });
    expect(itemRefFrom(el)).toEqual({ kind: 'edge', id: 'r1' });

    const io = memoryIo();
    io.set('k', { ok: true });
    expect(io.get('k', null)).toEqual({ ok: true });
    expect(io.keys()).toEqual(['k']);
    io.del('k');
    expect(io.get('k', 'fallback')).toBe('fallback');
  });

  it('tracks command overrides, conflicts, availability, and disabled commands', () => {
    const ctx = bootApp();
    const commands = ctx.contexts.commands;
    const help = commands.get('help.open') as CommandSpec;
    expect(commandShortcut(commands, 'help.open')).toBe('?');
    expect(commandShortcut(commands, 'selection.item.delete')).toBe('X');
    expect(commandShortcut(commands, 'graph.node.delete')).toBe('');
    expect(commands.shortcutConflict('help.open', 'P')?.id).toBe('palette.open');
    expect(commands.setShortcut('help.open', 'P')).toBe(false);
    expect(commands.setShortcut('help.open', 'H')).toBe(true);
    expect(help.shortcut).toBe('H');

    expect(commands.setEnabled('help.open', false)).toBe(true);
    expect(commands.run('help.open')).toBe(false);
    expect(commands.setEnabled('help.open', true)).toBe(true);
    expect(runCommand(ctx, 'help.open')).toBe(true);

    expect(commands.unregister('help.open')).toBeUndefined();
    expect(commands.get('help.open')).toBeUndefined();
  });

  it('treats a blank shortcut override as unbound, not wildcard', async () => {
    const ctx = bootApp();
    const commands = ctx.contexts.commands;

    expect(commands.setShortcut('help.open', '')).toBe(true);
    expect(commandShortcut(commands, 'help.open')).toBe('');

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
    await settle();

    expect(document.querySelector('.modal-layer')).toBeNull();
    expect(runCommand(ctx, 'help.open')).toBe(true);
    expect(document.querySelector('.modal-layer')).not.toBeNull();
  });
});
