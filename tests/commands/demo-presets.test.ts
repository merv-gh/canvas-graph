import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import type { Container } from '../../frontend/systems/container-entity';

const tick = async () => { await settle(); await new Promise(r => setTimeout(r, 0)); await settle(); };

const shell = () => document.querySelector<HTMLElement>('.shell')!;

/** Each demo builds a canonical graph AND activates its preset. */
describe('preset demos', () => {
  it('guide has one clean, preset-backed example for every collection', async () => {
    const cases = [
      ['demo.render-math', 'basic'],
      ['demo.render-kimi-k2', 'architecture'],
      ['demo.render-workflow', 'jira'],
      ['demo.render-flowchart', 'flowchart'],
      ['demo.render-mindmap', 'mindmap'],
      ['demo.render-c4', 'c4'],
      ['demo.render-uml', 'uml'],
      ['demo.render-outline', 'outline'],
      ['demo.render-agent-observability', 'autonomous'],
    ] as const;
    for (const [command, preset] of cases) {
      const ctx = bootApp();
      await settle();
      expect(runCommand(ctx, command)).toBe(true);
      await tick();
      expect(shell().getAttribute('data-preset')).toBe(preset);
      expect(ctx.graphs.current.nodes().length).toBeGreaterThan(2);
    }
  }, 15_000);

  it('agent observability guide uses reusable report node types', async () => {
    const ctx = bootApp();
    await settle();
    expect(runCommand(ctx, 'demo.render-agent-observability')).toBe(true);
    await tick();
    const types = new Set(ctx.graphs.current.nodes().map(node => node.NodeType));
    expect(types).toEqual(new Set(['agent', 'timeline-step', 'artifact', 'data-table', 'toggle', 'approval-gate']));
    expect(ctx.graphs.current.edges().some(edge => edge.Label?.text === 'retry if rejected')).toBe(true);
  });

  it('jira example uses exact canonical status labels and styles', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'demo.render-workflow');
    await tick();
    const statuses = ctx.graphs.current.nodes().map(node => ({
      label: node.Label.text, color: node.Color, fill: node.Fill,
    }));
    expect(statuses).toEqual([
      { label: 'Open', color: 'gray', fill: 'solid' },
      { label: 'In progress', color: 'yellow', fill: 'solid' },
      { label: 'Resolved', color: 'green', fill: 'solid' },
      { label: 'Closed', color: 'green', fill: 'solid' },
      { label: 'Reopened', color: 'gray', fill: 'solid' },
    ]);
  });

  it('uml: class boxes with member lists in a tree, preset applied', async () => {
    const ctx = bootApp();
    await settle();
    expect(runCommand(ctx, 'demo.render-uml')).toBe(true);
    await tick();

    const nodes = ctx.graphs.current.nodes();
    expect(nodes.map(node => node.Label.text)).toEqual(['User', 'Order', 'PaymentService', 'OrderRepository']);
    expect(nodes.every(node => node.NodeType === 'uml-class')).toBe(true);
    expect(nodes.find(node => node.Label.text === 'Order')!.Description).toContain('+ total(): Money');

    const edges = ctx.graphs.current.edges();
    expect(edges.map(edge => edge.Label?.text)).toEqual(['places', 'charged by', 'persisted by']);

    // Tree: User roots the flow, Order below it, service/repository at the leaves.
    const byLabel = (label: string) => nodes.find(node => node.Label.text === label)!;
    expect(byLabel('User').Position!.y).toBeLessThan(byLabel('Order').Position!.y);
    expect(byLabel('Order').Position!.y).toBeLessThan(byLabel('PaymentService').Position!.y);
    expect(shell().getAttribute('data-preset')).toBe('uml');
  });

  it('outline: nested containers opening to the right, preset applied', async () => {
    const ctx = bootApp();
    await settle();
    expect(runCommand(ctx, 'demo.render-outline')).toBe(true);
    await tick();

    const nodes = ctx.graphs.current.nodes();
    const byLabel = (label: string) => nodes.find(node => node.Label.text === label)!;
    expect(byLabel('Launch plan').NodeType).toBe('section-header');
    expect(nodes.filter(node => node.NodeType === 'list-item')).toHaveLength(7);

    const containers = ctx.graphs.current.itemsOfKind<Container>('container');
    const childIds = (title: string) =>
      containers.find(container => container.Label.text === title)!.Children.map(child => child.id);
    const research = childIds('Research');
    const pricing = childIds('Pricing');
    expect(research).toContain(byLabel('User interviews').id);
    expect(research).toContain(byLabel('Competitor scan').id);
    // Container-in-container: Pricing sits inside Research and holds its two leaves.
    const pricingContainer = containers.find(container => container.Label.text === 'Pricing')!;
    expect(research).toContain(pricingContainer.id);
    expect(pricing).toEqual([byLabel('Willingness-to-pay calls').id, byLabel('Tier draft').id]);
    expect(childIds('Launch week')).toEqual([byLabel('Announcement').id, byLabel('Docs refresh').id]);

    // Children open to the right inside their container row.
    const xs = ['User interviews', 'Competitor scan', 'Willingness-to-pay calls', 'Tier draft']
      .map(label => byLabel(label).Position!.x);
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    // Top-level rows flow downward.
    expect(byLabel('Launch plan').Position!.y).toBeLessThan(byLabel('Positioning').Position!.y);
    expect(byLabel('Positioning').Position!.y).toBeLessThan(byLabel('User interviews').Position!.y);
    expect(byLabel('User interviews').Position!.y).toBeLessThan(byLabel('Announcement').Position!.y);

    expect(shell().getAttribute('data-preset')).toBe('outline');
  });

  it('kimi-k2: architecture preset with legend, multiplier, operator, and diagram edge kinds', async () => {
    const ctx = bootApp();
    await settle();
    expect(runCommand(ctx, 'demo.render-kimi-k2')).toBe(true);
    await tick();

    expect(shell().getAttribute('data-preset')).toBe('architecture');

    const nodes = ctx.graphs.current.nodes();
    const byLabel = (label: string) => nodes.find(node => node.Label.text === label)!;
    expect(byLabel('⊕').NodeType).toBe('operator');
    expect(byLabel('⊕').Size).toEqual({ w: 44, h: 44 });
    expect(nodes.some(node => node.NodeType === 'caption')).toBe(true);

    const moeBlock = ctx.graphs.current.itemsOfKind<Container>('container')
      .find(container => container.Label.text.startsWith('Repeated transformer block'))!;
    expect(moeBlock.Legend).toEqual([
      { color: 'blue', label: 'Shared expert' },
      { color: 'orange', label: 'Routed experts' },
    ]);
    expect(moeBlock.Multiplier).toBe('60×');
    const memberIds = moeBlock.Children.map(child => child.id);
    expect(memberIds).toContain(byLabel('Sparse expert router').id);
    expect(memberIds).toContain(byLabel('⊕').id);

    const kinds = new Set(ctx.graphs.current.edges().map(edge => edge.EdgeKind));
    expect(kinds).toContain('plain');
    expect(kinds).toContain('dashed');
    expect(kinds).toContain('residual');
    // The residual skip runs from attention past the MoE block into the norm.
    const residual = ctx.graphs.current.edges().find(edge => edge.EdgeKind === 'residual')!;
    expect(residual.From).toBe(byLabel('Multi-head Latent Attention').id);
    expect(residual.To).toBe(byLabel('Residual + RMSNorm').id);

    // Legend + multiplier render on the stage (containers are never culled).
    expect(document.querySelector('.container-legend')).not.toBeNull();
    expect(document.querySelector('.container-multiplier')?.textContent).toBe('60×');

    // Fit-all deliberately keeps a readable ≥80% zoom (MIN_FIT_SCALE) and crops
    // wide graphs, so the far end is viewport-culled in the 900×600 test stage.
    // Pan the camera onto the ⊕ node to assert its rendering.
    const opPos = byLabel('⊕').Position!;
    ctx.contexts.view.set({ x: opPos.x - 450 / 0.8, y: opPos.y - 300 / 0.8, scale: 0.8 });
    ctx.bus.emit('view.changed', ctx.contexts.view.get());
    await tick();
    expect(document.querySelector('.node-type-operator')).not.toBeNull();
  });
});
