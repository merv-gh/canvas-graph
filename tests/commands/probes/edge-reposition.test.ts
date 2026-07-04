import { describe, expect, it } from 'vitest';
import { bootApp, settle } from '../testkit';

/** Edge fast path: moving a node must REPOSITION the incident edge's existing
 *  SVG group (same element identity, new coordinates + label transform), not
 *  tear it down and rebuild — that identity is what makes 10k-scale drags and
 *  nudges cheap, and what CSS easing keys off for nodes. */
describe('edge reposition fast path', () => {
  it('moves the existing edge element in place when an endpoint moves', async () => {
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false });
    await settle();
    ctx.bus.forward('graph.node.create', { Position: { x: 100, y: 100 } });
    ctx.bus.forward('graph.node.create', { Position: { x: 500, y: 100 } });
    await settle();
    ctx.bus.forward('graph.edge.create', { From: 'e1', To: 'e2', Label: { text: 'flows' }, EdgeKind: 'sync' });
    await settle();

    const edgeGroup = document.querySelector('g.edge');
    expect(edgeGroup).not.toBeNull();
    const lineBefore = edgeGroup!.querySelector('.edge-line')!;
    const x2Before = lineBefore.getAttribute('x2');
    const wrapBefore = edgeGroup!.querySelector('.edge-label-wrap')!;
    const transformBefore = wrapBefore.getAttribute('transform');

    ctx.bus.forward('item.update', { ref: { kind: 'node', id: 'e2' }, patch: { Position: { x: 700, y: 300 } } });
    await settle();

    const edgeGroupAfter = document.querySelector('g.edge');
    // Same element — repositioned, not rebuilt.
    expect(edgeGroupAfter).toBe(edgeGroup);
    expect(edgeGroupAfter!.querySelector('.edge-line')).toBe(lineBefore);
    expect(lineBefore.getAttribute('x2')).not.toBe(x2Before);
    expect(wrapBefore.getAttribute('transform')).not.toBe(transformBefore);

    // A non-position change (label text) must bump the version and REBUILD.
    ctx.bus.forward('item.update', { ref: { kind: 'edge', id: 'r1' }, patch: { Label: { text: 'renamed' } } });
    await settle();
    const rebuilt = document.querySelector('g.edge');
    expect(rebuilt).not.toBe(edgeGroup);
    expect(rebuilt!.textContent).toContain('renamed');
  }, 15000);
});
