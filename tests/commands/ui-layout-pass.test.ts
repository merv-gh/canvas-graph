import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import { mermaidToSnapshot } from '../../frontend/systems/share';

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
});

describe('mermaid edge kind', () => {
  it('does not leak an edge label into EdgeKind', async () => {
    const snapshot = await mermaidToSnapshot('flowchart TD\n  A --"heavy async retry"--> B');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.edges[0].EdgeKind).toBe('sync');
    expect(snapshot!.edges[0].Label?.text).toBe('heavy async retry');
  });
});
