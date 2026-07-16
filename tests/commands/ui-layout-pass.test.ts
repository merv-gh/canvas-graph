import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import { mermaidToSnapshot } from '../../frontend/systems/share';
import { edgeLabelGeometry } from '../../frontend/model/entities';
import { intersectRectBoundary } from '../../frontend/core/geometry';
import { Places } from '../../frontend/types';

const rectOf = (n: { Position: { x: number; y: number }; Size: { w: number; h: number } }) =>
  ({ x: n.Position.x - n.Size.w / 2, y: n.Position.y - n.Size.h / 2, w: n.Size.w, h: n.Size.h });
const overlaps = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('node autosize', () => {
  const byText = (ctx: ReturnType<typeof bootApp>, text: string) =>
    ctx.graphs.current.nodes().find(n => n.Label.text === text)!;

  it('sizes a node box to its text — longer/multiline content is larger', async () => {
    const ctx = bootApp();
    ctx.bus.emit('graph.node.create', { Label: { text: 'A' } });
    ctx.bus.emit('graph.node.create', { Label: { text: 'A much longer node title here' }, Description: 'line one\nline two\nline three' });
    await settle();

    const s = byText(ctx, 'A');
    const l = byText(ctx, 'A much longer node title here');
    expect(l.Size.w).toBeGreaterThan(s.Size.w);
    expect(l.Size.h).toBeGreaterThan(s.Size.h);
  });

  it('yields to a manual resize (stops auto-fitting once the user resizes)', async () => {
    const ctx = bootApp();
    ctx.bus.emit('graph.node.create', { Label: { text: 'Hi' } });
    await settle();
    const id = byText(ctx, 'Hi').id;
    ctx.bus.emit('item.update', { ref: { kind: 'node', id }, patch: { Size: { w: 500, h: 300 } } });
    await settle();
    // A later text edit must not clobber the manual size.
    ctx.bus.emit('item.update', { ref: { kind: 'node', id }, patch: { Label: { text: 'Hi there friend' } } });
    await settle();
    expect(ctx.graphs.current.getNode(id)!.Size).toEqual({ w: 500, h: 300 });
  });
});

describe('layout spacing', () => {
  it('tidy lays out nodes without any overlap', async () => {
    const ctx = bootApp();
    const ids = Array.from({ length: 6 }, (_, i) => ctx.graphs.current.createNode({ Label: { text: `Node ${i} with some text` } }).id);
    ctx.bus.emit('graph.edge.create', { From: ids[0], To: ids[1] });
    ctx.bus.emit('graph.edge.create', { From: ids[0], To: ids[2] });
    ctx.bus.emit('graph.edge.create', { From: ids[1], To: ids[3] });
    ctx.bus.emit('graph.edge.create', { From: ids[2], To: ids[4] });
    await settle();
    runCommand(ctx, 'layout.apply.tidy');
    await settle();

    const rects = ctx.graphs.current.nodes().map(rectOf);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++)
        expect(overlaps(rects[i], rects[j]), `nodes ${i}/${j} overlap`).toBe(false);
  });

  it('reserves readable space for long edge labels', async () => {
    const ctx = bootApp();
    const root = ctx.graphs.current.createNode({ Label: { text: 'Root' }, Size: { w: 160, h: 72 } });
    const left = ctx.graphs.current.createNode({ Label: { text: 'Left' }, Size: { w: 160, h: 72 } });
    const right = ctx.graphs.current.createNode({ Label: { text: 'Right' }, Size: { w: 160, h: 72 } });
    ctx.bus.emit('graph.edge.create', {
      From: root.id,
      To: left.id,
      Label: { text: 'A deliberately long relationship label that must remain readable' },
    });
    ctx.bus.emit('graph.edge.create', { From: root.id, To: right.id });
    await settle();
    runCommand(ctx, 'layout.apply.tidy');
    await settle();

    const children = [ctx.graphs.current.getNode(left.id)!, ctx.graphs.current.getNode(right.id)!]
      .sort((a, b) => a.Position.x - b.Position.x);
    const clearGap = children[1].Position.x - children[1].Size.w / 2
      - (children[0].Position.x + children[0].Size.w / 2);
    expect(clearGap).toBeGreaterThanOrEqual(315); // base gap + capped label width budget
  });

  it('treats rendered edge labels as collision rectangles', async () => {
    const ctx = bootApp({ autoLayout: false });
    const root = ctx.graphs.current.createNode({ Label: { text: 'Root' }, Size: { w: 160, h: 72 } });
    const a = ctx.graphs.current.createNode({ Label: { text: 'A' }, Size: { w: 160, h: 72 } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'B' }, Size: { w: 160, h: 72 } });
    ctx.bus.emit('graph.edge.create', { From: root.id, To: a.id, Label: { text: 'prepare\nvalidated payload' } });
    ctx.bus.emit('graph.edge.create', { From: root.id, To: b.id, Label: { text: 'publish\nreview outcome' } });
    await settle();
    runCommand(ctx, 'layout.apply.tidy');
    await settle();

    const nodes = ctx.graphs.current.nodes();
    const nodeRects = nodes.map(rectOf);
    const labelRects = ctx.graphs.current.edges().map(edge => {
      const from = ctx.graphs.current.getNode(edge.From)!;
      const to = ctx.graphs.current.getNode(edge.To)!;
      const source = intersectRectBoundary(to.Position!, from.Position!, { w: from.Size.w / 2, h: from.Size.h / 2 });
      const target = intersectRectBoundary(from.Position!, to.Position!, { w: to.Size.w / 2, h: to.Size.h / 2 });
      return edgeLabelGeometry(edge.Label!.text, source, target, edge.id, nodeRects).rect;
    });
    labelRects.forEach((label, labelIndex) => {
      nodeRects.forEach((node, nodeIndex) => {
        expect(overlaps(label, node), `label ${labelIndex} overlaps node ${nodeIndex}`).toBe(false);
      });
    });
    expect(overlaps(labelRects[0], labelRects[1]), 'edge labels overlap each other').toBe(false);
  });

  it('offsets a near-vertical label by its width so it clears the arrow axis', () => {
    const geometry = edgeLabelGeometry('wide relationship label', { x: 0, y: 0 }, { x: 0, y: 240 }, 'r1');
    expect(geometry.rect.x + geometry.rect.w).toBeLessThanOrEqual(-10);
    expect(geometry.anchor.y).toBeLessThan(240 * 0.6);
  });
});

describe('view fit', () => {
  it('centres content in the canvas area not covered by the navigator', async () => {
    const ctx = bootApp();
    const stage = ctx.contexts.places.el(Places.Stage)!;
    const left = ctx.contexts.places.el(Places.Left)!;
    stage.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600,
      toJSON: () => ({}),
    } as DOMRect);
    left.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 280, bottom: 600, width: 280, height: 600,
      toJSON: () => ({}),
    } as DOMRect);
    const toggle = document.querySelector<HTMLElement>('[data-fold-id="outline.panel"]')!;
    toggle.click();
    await settle();
    const navigator = left.querySelector<HTMLElement>('.graph-navigator')!;
    navigator.getBoundingClientRect = left.getBoundingClientRect;
    ctx.graphs.current.replace({
      schemaVersion: 1,
      nodes: [{ id: 'e1', Label: { text: 'Readable document' }, Position: { x: 0, y: 0 }, Size: { w: 160, h: 72 } }],
      edges: [],
      extensions: { requirementsMap: { version: 2, rootContainerId: 'c0', attributeContainers: [] } },
    });
    const node = ctx.graphs.current.getNode('e1')!;
    await settle();
    runCommand(ctx, 'view.fit.all');

    const view = ctx.contexts.view.get();
    const screenCenter = (node.Position.x - view.x) * view.scale;
    expect(screenCenter).toBeCloseTo(564, 0); // centre of unobscured x=300…828 frame
    expect((node.Position.x - node.Size.w / 2 - view.x) * view.scale).toBeGreaterThan(280);
  });

  it('re-fits against the current stage and open navigator after window resize', async () => {
    const ctx = bootApp({ autoLayout: false });
    const stage = ctx.contexts.places.el(Places.Stage)!;
    const left = ctx.contexts.places.el(Places.Left)!;
    let stageWidth = 1000;
    stage.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: stageWidth, bottom: 600, width: stageWidth, height: 600,
      toJSON: () => ({}),
    } as DOMRect);
    document.querySelector<HTMLElement>('[data-fold-id="outline.panel"]')!.click();
    await settle();
    const navigator = left.querySelector<HTMLElement>('.graph-navigator')!;
    navigator.getBoundingClientRect = () => ({
      x: 12, y: 12, left: 12, top: 12, right: 292, bottom: 588, width: 280, height: 576,
      toJSON: () => ({}),
    } as DOMRect);
    ctx.graphs.current.createNode({ Label: { text: 'Resize target' }, Position: { x: 0, y: 0 }, Size: { w: 160, h: 72 } });
    runCommand(ctx, 'view.fit.all');
    const before = ctx.contexts.view.spaceToScreen({ x: 0, y: 0 }).x;

    stageWidth = 760;
    window.dispatchEvent(new Event('resize'));
    await settle();
    const after = ctx.contexts.view.spaceToScreen({ x: 0, y: 0 }).x;
    expect(after).not.toBe(before);
    expect(after).toBeCloseTo((312 + (760 - 72)) / 2, 0);
  });
});

describe('mermaid edge kind', () => {
  it('does not leak an edge label into EdgeKind', async () => {
    const snapshot = await mermaidToSnapshot('flowchart TD\n  A --"heavy async retry"--> B');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.edges[0].EdgeKind).toBe('sync');
    expect(snapshot!.edges[0].Label?.text).toBe('heavy async retry');
  });
});
