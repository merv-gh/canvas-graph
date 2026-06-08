import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';

/** Each test simulates the *exact* keystrokes a user would press and asserts
 *  the resulting graph state. The keystroke count matches Principle 17's
 *  budget table — raising it requires either updating the principle or
 *  redesigning the journey. */

const captureInput = () => document.querySelector<HTMLInputElement>('input[data-keyboard-mode]');

const pressLetter = (letter: string) => {
  const el = captureInput();
  if (!el) throw new Error('No keyboard capture active to receive key');
  el.dispatchEvent(new KeyboardEvent('keydown', { key: letter, bubbles: true, cancelable: true }));
};

describe('Principle 17 — canonical journey keystroke budgets', () => {
  it('Create floating node: 1 keystroke (A)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(ctx.selection.selectedNode()?.id).toBe(ctx.graphs.current.nodes()[0].id);
  });

  it('Create child of selected (selection moves): 1 keystroke (A)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create'); // seed parent
    await settle();
    const parent = ctx.graphs.current.nodes()[0];
    runCommand(ctx, 'editing.node.create'); // 1 keystroke under test
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
    expect(ctx.graphs.current.edges()).toHaveLength(1);
    const edge = ctx.graphs.current.edges()[0];
    expect(edge.From).toBe(parent.id);
    expect(ctx.selection.selectedNode()?.id).not.toBe(parent.id);
  });

  it('Create child of selected (selection stays): 1 keystroke (Shift+A)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const parent = ctx.graphs.current.nodes()[0];
    runCommand(ctx, 'editing.node.create.keep'); // 1 keystroke under test
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
    expect(ctx.graphs.current.edges()).toHaveLength(1);
    expect(ctx.selection.selectedNode()?.id).toBe(parent.id); // stays
  });

  it('Chain of 3 nodes: 3 keystrokes (A A A)', async () => {
    const ctx = bootV2();
    await settle();
    for (let i = 0; i < 3; i++) {
      runCommand(ctx, 'editing.node.create');
      await settle();
    }
    expect(ctx.graphs.current.nodes()).toHaveLength(3);
    expect(ctx.graphs.current.edges()).toHaveLength(2);
    const edges = ctx.graphs.current.edges();
    // each new node is wired from the previous one — a linear chain
    expect(edges[0].From).toBe(ctx.graphs.current.nodes()[0].id);
    expect(edges[0].To).toBe(ctx.graphs.current.nodes()[1].id);
    expect(edges[1].From).toBe(ctx.graphs.current.nodes()[1].id);
    expect(edges[1].To).toBe(ctx.graphs.current.nodes()[2].id);
  });

  it('3 siblings off one anchor: 3 keystrokes (Shift+A × 3)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const anchor = ctx.graphs.current.nodes()[0];
    for (let i = 0; i < 3; i++) {
      runCommand(ctx, 'editing.node.create.keep');
      await settle();
    }
    expect(ctx.graphs.current.nodes()).toHaveLength(4);
    expect(ctx.graphs.current.edges()).toHaveLength(3);
    // every edge originates from the anchor
    ctx.graphs.current.edges().forEach(edge => expect(edge.From).toBe(anchor.id));
    expect(ctx.selection.selectedNode()?.id).toBe(anchor.id);
  });

  it('Edge from selected to picked: 2 keystrokes (E + letter)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create.keep');
    await settle();
    const source = ctx.graphs.current.nodes()[0];
    const target = ctx.graphs.current.nodes()[1];
    // selection sits on source after the two creates above
    expect(ctx.selection.selectedNode()?.id).toBe(source.id);
    // already 1 edge from the Shift+A chain; this test is about the second edge
    const baselineEdges = ctx.graphs.current.edges().length;

    runCommand(ctx, 'editing.edge.create'); // keystroke 1: opens picker, From seeded
    await settle();
    pressLetter('a');                     // keystroke 2: picks 'To'
    await settle();

    expect(ctx.graphs.current.edges().length).toBe(baselineEdges + 1);
    const newEdge = ctx.graphs.current.edges().at(-1)!;
    expect(newEdge.From).toBe(source.id);
    expect(newEdge.To).toBe(target.id);
  });

  it('Edge with both endpoints picked: 3 keystrokes (E + letter + letter)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create.keep');
    await settle();
    ctx.bus.emit('selection.item.clear');  // unset selection so From step has no seed
    await settle();
    const baselineEdges = ctx.graphs.current.edges().length;

    runCommand(ctx, 'editing.edge.create'); // keystroke 1
    await settle();
    pressLetter('a');                     // keystroke 2: From
    await settle();
    pressLetter('a');                     // keystroke 3: To (first available after From excluded)
    await settle();

    expect(ctx.graphs.current.edges().length).toBe(baselineEdges + 1);
  });

  it('Jump to any item: 2 keystrokes (G + letter)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create.keep');
    await settle();
    const target = ctx.graphs.current.nodes()[1];

    runCommand(ctx, 'jump.start'); // keystroke 1
    await settle();
    pressLetter('s');              // keystroke 2 (second item maps to LETTERS[1] = 's')
    await settle();

    expect(ctx.selection.focused()).toEqual({ kind: 'node', id: target.id });
  });

  it('Delete selected: 1 keystroke (X)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    runCommand(ctx, 'selection.item.delete');
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(0);
  });

  it('Cycle selection: 1 keystroke (Tab)', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create.keep');
    await settle();
    const first = ctx.graphs.current.nodes()[0].id;
    const second = ctx.graphs.current.nodes()[1].id;
    ctx.bus.emit('selection.node.select', { id: first });
    await settle();
    runCommand(ctx, 'selection.node.next');
    await settle();
    expect(ctx.selection.selectedNode()?.id).toBe(second);
  });
});
