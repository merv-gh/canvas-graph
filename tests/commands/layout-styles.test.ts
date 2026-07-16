import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../frontend/model';
import { bootApp, runCommand, settle } from './testkit';

const nodeByLabel = (nodes: GraphNode[], label: string) =>
  nodes.find(node => node.Label.text === label)!;

const press = (key: string, shiftKey = false) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  }));
};

const fixture = () => {
  const ctx = bootApp({ autoLayout: false });
  const graph = ctx.graphs.current;
  const root = graph.createNode({ Label: { text: 'Root' }, Position: { x: 0, y: 0 }, Size: { w: 150, h: 64 } });
  const area = graph.createNode({ Label: { text: 'Area' }, Position: { x: 220, y: 0 }, Size: { w: 180, h: 80 } });
  const detail = graph.createNode({ Label: { text: 'Detail' }, Position: { x: 440, y: 0 }, Size: { w: 210, h: 96 } });
  const second = graph.createNode({ Label: { text: 'Second' }, Position: { x: 0, y: 180 }, Size: { w: 160, h: 72 } });
  graph.createEdge({ From: root.id, To: area.id });
  graph.createEdge({ From: area.id, To: detail.id });
  graph.createEdge({ From: root.id, To: second.id });
  return { ctx, root, area, detail, second };
};

describe('layout styles', () => {
  it('lays out vertical, horizontal, tree, and radial grammars deterministically', () => {
    const { ctx, root, area, detail, second } = fixture();

    ctx.bus.emit('layout.apply.vertical');
    expect(ctx.layout?.active()).toBe('vertical');
    expect(root.Position!.y).toBeLessThan(area.Position!.y);
    expect(area.Position!.y).toBeLessThan(detail.Position!.y);
    expect(detail.Position!.y).toBeLessThan(second.Position!.y);
    expect(area.Position!.x).toBeGreaterThan(root.Position!.x);
    expect(detail.Position!.x).toBeGreaterThan(area.Position!.x);
    const vertical = ctx.graphs.current.nodes().map(node => ({ ...node.Position }));
    ctx.bus.emit('layout.apply.vertical');
    expect(ctx.graphs.current.nodes().map(node => ({ ...node.Position }))).toEqual(vertical);

    ctx.bus.emit('layout.apply.horizontal');
    expect(ctx.layout?.active()).toBe('horizontal');
    expect(root.Position!.x).toBeLessThan(area.Position!.x);
    expect(area.Position!.x).toBeLessThan(detail.Position!.x);
    expect(detail.Position!.x).toBeLessThan(second.Position!.x);
    expect(area.Position!.y).toBeGreaterThan(root.Position!.y);
    expect(detail.Position!.y).toBeGreaterThan(area.Position!.y);
    const horizontal = ctx.graphs.current.nodes().map(node => ({ ...node.Position }));
    ctx.bus.emit('layout.apply.horizontal');
    expect(ctx.graphs.current.nodes().map(node => ({ ...node.Position }))).toEqual(horizontal);

    ctx.bus.emit('layout.apply.tree');
    expect(ctx.layout?.active()).toBe('tree');
    expect(area.Position!.y).toBeGreaterThan(root.Position!.y);
    expect(second.Position!.y).toBe(area.Position!.y);
    expect(detail.Position!.y).toBeGreaterThan(area.Position!.y);
    const tree = ctx.graphs.current.nodes().map(node => ({ ...node.Position }));
    ctx.bus.emit('layout.apply.tree');
    expect(ctx.graphs.current.nodes().map(node => ({ ...node.Position }))).toEqual(tree);

    ctx.bus.emit('selection.node.select', { id: root.id });
    ctx.bus.emit('focus.node.focus', { id: root.id });
    const center = { ...root.Position! };
    ctx.bus.emit('layout.apply.radial');
    expect(ctx.layout?.active()).toBe('radial');
    expect(root.Position).toEqual(center);
    [area, detail, second].forEach(node => {
      expect(Math.hypot(node.Position!.x - center.x, node.Position!.y - center.y)).toBeGreaterThan(150);
    });
    const radial = ctx.graphs.current.nodes().map(node => ({ ...node.Position }));
    ctx.bus.emit('layout.apply.radial');
    expect(ctx.graphs.current.nodes().map(node => ({ ...node.Position }))).toEqual(radial);
  });

  it('uses V/H/T/R as mode shortcuts and exposes the active style as a pressed control', async () => {
    const ctx = bootApp({ autoLayout: false });
    await settle();
    expect(ctx.layout?.active()).toBe('tree');
    expect(document.querySelector('[data-command="layout.apply.tree"]')?.getAttribute('aria-pressed')).toBe('true');

    press('v');
    await settle();
    expect(ctx.layout?.active()).toBe('vertical');
    expect(document.querySelector('[data-command="layout.apply.vertical"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(ctx.contexts.commands.get('editing.node.create')?.label).toContain('below');
    expect(ctx.contexts.commands.get('editing.node.create.keep')?.label).toContain('right');

    press('h');
    press('t');
    press('r');
    await settle();
    expect(ctx.layout?.active()).toBe('radial');
    expect(ctx.graphs.current.snapshotExtension('layoutStyle')).toEqual({ version: 1, kind: 'radial' });
  });

  it('keeps each graph layout style in its snapshot and through duplication', async () => {
    const ctx = bootApp({ autoLayout: false });
    const sourceId = ctx.graphs.current.id;
    runCommand(ctx, 'layout.apply.vertical');
    expect(ctx.graphs.current.snapshot().extensions?.layoutStyle).toEqual({ version: 1, kind: 'vertical' });

    expect(runCommand(ctx, 'graph.duplicate')).toBe(true);
    await settle();
    expect(ctx.graphs.current.id).not.toBe(sourceId);
    expect(ctx.layout?.active()).toBe('vertical');
    expect(ctx.graphs.current.snapshot().extensions?.layoutStyle).toEqual({ version: 1, kind: 'vertical' });

    runCommand(ctx, 'graph.create');
    await settle();
    expect(ctx.layout?.active()).toBe('tree');
    ctx.bus.emit('graph.switch', { id: sourceId });
    await settle();
    expect(ctx.layout?.active()).toBe('vertical');
  });

  it('makes A advance a vertical list and Shift+A create its connected right branch', async () => {
    const ctx = bootApp({ autoLayout: false });
    runCommand(ctx, 'editing.node.create');
    await settle();
    const first = ctx.selection.selectedNode()!;

    press('v');
    await settle();
    press('a');
    await settle();
    const next = ctx.selection.selectedNode()!;
    expect(next.id).not.toBe(first.id);
    expect(next.Position!.x).toBe(first.Position!.x);
    expect(next.Position!.y).toBeGreaterThan(first.Position!.y);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(document.querySelectorAll('.node.selected')).toHaveLength(1);

    press('A', true);
    await settle();
    expect(ctx.selection.selectedNode()?.id).toBe(next.id);
    const branch = ctx.graphs.current.nodes().at(-1)!;
    expect(branch.Position!.x).toBeGreaterThan(next.Position!.x);
    expect(branch.Position!.y).toBe(next.Position!.y);
    expect(ctx.graphs.current.edges()).toHaveLength(1);
    expect(ctx.graphs.current.edges()[0]).toMatchObject({ From: next.id, To: branch.id });
  });

  it('mirrors primary and branch creation for horizontal, tree, and radial modes', async () => {
    const ctx = bootApp({ autoLayout: false });
    runCommand(ctx, 'editing.node.create');
    await settle();
    const anchor = ctx.selection.selectedNode()!;

    runCommand(ctx, 'layout.apply.horizontal');
    const beforeHorizontal = ctx.graphs.current.edges().length;
    runCommand(ctx, 'editing.node.create');
    await settle();
    const horizontalNext = ctx.selection.selectedNode()!;
    expect(horizontalNext.Position!.x).toBeGreaterThan(anchor.Position!.x);
    expect(horizontalNext.Position!.y).toBe(anchor.Position!.y);
    expect(ctx.graphs.current.edges()).toHaveLength(beforeHorizontal);
    runCommand(ctx, 'editing.node.create.keep');
    await settle();
    const horizontalBranch = ctx.graphs.current.nodes().at(-1)!;
    expect(horizontalBranch.Position!.y).toBeGreaterThan(horizontalNext.Position!.y);
    expect(ctx.selection.selectedNode()?.id).toBe(horizontalNext.id);

    runCommand(ctx, 'layout.apply.tree');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const treeChild = ctx.selection.selectedNode()!;
    expect(treeChild.Position!.y).toBeGreaterThan(horizontalNext.Position!.y);
    expect(ctx.graphs.current.edges().at(-1)).toMatchObject({ From: horizontalNext.id, To: treeChild.id });

    runCommand(ctx, 'layout.apply.radial');
    const hub = ctx.selection.selectedNode()!;
    runCommand(ctx, 'editing.node.create.keep');
    await settle();
    const spoke = ctx.graphs.current.nodes().at(-1)!;
    expect(ctx.selection.selectedNode()?.id).toBe(hub.id);
    expect(Math.hypot(spoke.Position!.x - hub.Position!.x, spoke.Position!.y - hub.Position!.y)).toBeGreaterThan(200);
    expect(ctx.graphs.current.edges().at(-1)).toMatchObject({ From: hub.id, To: spoke.id });
  });

  it('opens the expanded Game graph as a readable vertical nested list', async () => {
    const ctx = bootApp({ autoLayout: false });
    expect(runCommand(ctx, 'demo.render-game')).toBe(true);
    await settle();

    const nodes = ctx.graphs.current.nodes();
    expect(ctx.graphs.current.name).toBe('Game');
    expect(nodes).toHaveLength(21);
    expect(ctx.graphs.current.edges()).toHaveLength(20);
    expect(nodes.every(node => !!node.Description?.trim())).toBe(true);
    expect(ctx.layout?.active()).toBe('vertical');

    const game = nodeByLabel(nodes, 'Game');
    const narrative = nodeByLabel(nodes, 'Narrative');
    const story = nodeByLabel(nodes, 'Story');
    const audio = nodeByLabel(nodes, 'Audio');
    const runtimeMix = nodeByLabel(nodes, 'Runtime mix');
    expect(narrative.Position!.x).toBeGreaterThan(game.Position!.x);
    expect(story.Position!.x).toBeGreaterThan(narrative.Position!.x);
    expect(game.Position!.y).toBeLessThan(narrative.Position!.y);
    expect(narrative.Position!.y).toBeLessThan(story.Position!.y);
    expect(audio.Position!.y).toBeGreaterThan(story.Position!.y);
    expect(runtimeMix.Position!.y).toBeGreaterThan(audio.Position!.y);

    const ordered = [...nodes].sort((a, b) => a.Position!.y - b.Position!.y);
    ordered.slice(1).forEach((node, index) => {
      const previous = ordered[index];
      expect(node.Position!.y - node.Size.h / 2).toBeGreaterThanOrEqual(previous.Position!.y + previous.Size.h / 2 + 23);
    });
  });
});
