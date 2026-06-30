import { describe, expect, it, vi } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import { decodeSystemDesignSnapshot } from '../../frontend/systems/system-design';

describe('system design tools', () => {
  it('loads the image-search example, renders observations, and round-trips a share link', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const ctx = bootApp();
    await settle();
    expect(document.querySelector('.tool-panel[data-panel-id="system-design"]')).not.toBeNull();

    runCommand(ctx, 'systemDesign.demo.imageSearch');
    await settle();

    expect(ctx.graphs.current.nodes()).toHaveLength(15);
    expect(ctx.graphs.current.edges()).toHaveLength(15);
    expect(ctx.graphs.current.getNode('e12')?.NodeType).toBe('kafka');
    expect(document.querySelector('.design-hints')?.textContent).toContain('Sequential round trip');

    let sharedUrl = '';
    ctx.bus.on('systemDesign.shared', ({ url }) => { sharedUrl = url; });
    runCommand(ctx, 'systemDesign.share.copy');
    await settle();

    const encoded = new URL(sharedUrl).searchParams.get('g');
    expect(encoded?.length).toBeGreaterThan(100);
    const decoded = decodeSystemDesignSnapshot(encoded ?? '');
    expect(decoded?.nodes).toHaveLength(15);

    const linked = bootApp();
    linked.bus.emit('graph.import.snapshot', decoded!);
    await settle();

    expect(linked.graphs.current.nodes()).toHaveLength(15);
    expect(linked.graphs.current.edges()).toHaveLength(15);
    expect(linked.graphs.current.getNode('e9')?.Label.text).toBe('MyService');
    expect(linked.graphs.current.getEdge('r10')?.EdgeKind).toBe('sync');
  });
});
