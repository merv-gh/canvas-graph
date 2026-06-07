import { describe, expect, it } from 'vitest';
import {
  commandShortcut,
  grouped,
  itemRefFrom,
  memoryIo,
  nodeRect,
  parseShortcut,
  shortcutOf,
} from '../../v2/core';
import { Graph, graphStore } from '../../v2/model';
import type { CommandSpec } from '../../v2/types';
import { bootV2, runCommand } from './v2-testkit';

describe('v2 model and core helpers', () => {
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
    el.dataset.itemKind = 'edge';
    el.dataset.itemId = 'r1';
    expect(itemRefFrom(el)).toEqual({ kind: 'edge', id: 'r1' });

    const io = memoryIo();
    io.set('k', { ok: true });
    expect(io.get('k', null)).toEqual({ ok: true });
    expect(io.keys()).toEqual(['k']);
    io.del('k');
    expect(io.get('k', 'fallback')).toBe('fallback');
  });

  it('tracks command overrides, conflicts, availability, and disabled commands', () => {
    const ctx = bootV2();
    const commands = ctx.contexts.commands;
    const help = commands.get('help.open') as CommandSpec;
    expect(commandShortcut(commands, 'help.open')).toBe('?');
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
});
