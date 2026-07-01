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
    expect(ctx.graphs.current.getNode('e8')?.Purpose).toContain('fast lookups');
    expect(ctx.graphs.current.getEdge('r9')?.Observability).toContain('lag');
    expect(document.querySelector('.design-hints')?.textContent).toContain('Sequential round trip');
    expect(document.querySelector('[data-node-type="index"]')?.getAttribute('title')).toContain('Purpose:');

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
    expect(linked.graphs.current.getEdge('r10')?.Limits).toContain('tail latency');
  });

  it('loads a semantics-heavy checkout example with failure and freshness observations', async () => {
    const ctx = bootApp();
    await settle();

    runCommand(ctx, 'systemDesign.demo.resilientCheckout');
    await settle();

    const text = document.querySelector('.design-hints')?.textContent ?? '';
    expect(ctx.graphs.current.nodes()).toHaveLength(12);
    expect(ctx.graphs.current.edges()).toHaveLength(12);
    expect(ctx.graphs.current.getNode('e11')?.DataScale).toBe('huge');
    expect(ctx.graphs.current.getNode('e11')?.FreshnessMs).toBe(45_000);
    expect(ctx.graphs.current.getEdge('r5')?.FailureMode).toContain('idempotency');
    expect(document.querySelector('.node.semantic-big-data')).not.toBeNull();
    expect(text).toContain('Sync edge');
    expect(text).toContain('writes to');
    expect(text).toContain('makes big data readable');
  });

  it('turns observations into mechanical graph actions', async () => {
    const ctx = bootApp();
    await settle();

    runCommand(ctx, 'systemDesign.demo.resilientCheckout');
    await settle();

    const queueAction = document.querySelector('[data-semantic-action="queue-edge"][data-semantic-id="r1"]') as HTMLElement | null;
    expect(queueAction).not.toBeNull();

    runCommand(ctx, 'systemDesign.action.apply', { target: queueAction });
    await settle();

    expect(ctx.graphs.current.getEdge('r1')).toBeUndefined();
    expect(ctx.graphs.current.nodes()).toHaveLength(13);
    expect(ctx.graphs.current.edges()).toHaveLength(13);
    expect(ctx.graphs.current.nodes().some(node => node.Label.text === 'POST /checkout queue' && node.NodeType === 'kafka')).toBe(true);
    expect(ctx.graphs.current.edges().filter(edge => edge.Label?.text.includes('POST /checkout') && edge.EdgeKind === 'async')).toHaveLength(2);
  });

  it('adds cache and circuit-breaker concepts from observations', async () => {
    const ctx = bootApp();
    await settle();

    runCommand(ctx, 'systemDesign.demo.imageSearch');
    await settle();

    const cacheAction = document.querySelector('[data-semantic-action="cache-edge"][data-semantic-id="r8"]') as HTMLElement | null;
    expect(cacheAction).not.toBeNull();
    runCommand(ctx, 'systemDesign.action.apply', { target: cacheAction });
    await settle();

    expect(ctx.graphs.current.getEdge('r8')).toBeUndefined();
    expect(ctx.graphs.current.nodes().some(node => node.NodeType === 'cache' && node.Label.text === 'kNN query cache')).toBe(true);

    runCommand(ctx, 'systemDesign.demo.resilientCheckout');
    await settle();
    const breakerAction = document.querySelector('[data-semantic-action="circuit-breaker-edge"][data-semantic-id="r5"]') as HTMLElement | null;
    expect(breakerAction).not.toBeNull();
    runCommand(ctx, 'systemDesign.action.apply', { target: breakerAction });
    await settle();

    expect(ctx.graphs.current.getEdge('r5')).toBeUndefined();
    expect(ctx.graphs.current.nodes().some(node => node.NodeType === 'circuit-breaker' && node.Label.text === 'authorize payment breaker')).toBe(true);
    expect(ctx.graphs.current.edges().filter(edge => edge.Label?.text.includes('authorize payment') && edge.EdgeKind === 'sync')).toHaveLength(2);
  });

  it('walks through learning mode and exercises live hints', async () => {
    const ctx = bootApp();
    await settle();

    runCommand(ctx, 'systemDesign.presentation.start');
    await settle();

    expect(ctx.graphs.current.nodes()).toHaveLength(6);
    expect(ctx.graphs.current.edges()).toHaveLength(6);
    expect(document.querySelector('.design-presentation')?.textContent).toContain('rough checkout');
    expect(document.querySelector('.design-hints')?.textContent).toContain('capacity below edge traffic');

    runCommand(ctx, 'systemDesign.presentation.next');
    await settle();
    expect(document.querySelector('.design-presentation')?.textContent).toContain('Shape excess traffic');

    runCommand(ctx, 'systemDesign.presentation.apply');
    await settle();
    expect(ctx.graphs.current.nodes().some(node => node.NodeType === 'rate-limit' && node.Label.text === 'API Gateway limiter')).toBe(true);

    runCommand(ctx, 'systemDesign.presentation.next');
    await settle();
    expect(document.querySelector('.design-presentation')?.textContent).toContain('Protect the slow external payment call');

    runCommand(ctx, 'systemDesign.presentation.apply');
    await settle();
    expect(ctx.graphs.current.getEdge('r3')).toBeUndefined();
    expect(ctx.graphs.current.nodes().some(node => node.NodeType === 'circuit-breaker' && node.Label.text === 'authorize payment breaker')).toBe(true);
    expect(document.querySelector('.design-hints')?.textContent).toContain('Sync edge');
  });
});
