import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import type { Container } from '../../frontend/systems/container-entity';

const tick = async () => { await settle(); await new Promise(r => setTimeout(r, 0)); await settle(); };

/** Nested doc exercising: heading descriptions, an item description, a
 *  container (Discover), a nested container (Markets), and sibling rows. */
const DOC = [
  '# Phase one',
  'Kickoff tasks',
  '- Discover',
  '  interview notes',
  '  - Users',
  '  - Markets',
  '    - Niches',
  '- Build',
  '# Phase two',
  '- Ship',
].join('\n');

const importDoc = async (ctx: ReturnType<typeof bootApp>) => {
  ctx.bus.emit('graph.import.markdown', { source: DOC });
  await tick();
  ctx.bus.emit('graph.import.confirm');
  await tick();
};

describe('markdown outline import', () => {
  it('previews the parsed snapshot before replacing the graph', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.import.markdown', { source: DOC });
    await tick();
    expect(ctx.graphs.current.nodes()).toHaveLength(0);
    expect(document.querySelector('.import-preview')?.textContent).toContain('Markdown outline: 7 nodes and 4 edges');
  });

  it('builds nodes, containers, and sequential edges from the outline', async () => {
    const ctx = bootApp();
    await settle();
    await importDoc(ctx);

    const nodes = ctx.graphs.current.nodes();
    expect(nodes.map(node => node.Label.text)).toEqual([
      'Phase one', 'interview notes', 'Users', 'Niches', 'Build', 'Phase two', 'Ship',
    ]);
    expect(nodes.map(node => node.NodeType)).toEqual([
      'section-header', 'list-item', 'list-item', 'list-item', 'list-item', 'section-header', 'list-item',
    ]);
    expect(nodes[0].Description).toBe('Kickoff tasks');

    const containers = ctx.graphs.current.itemsOfKind<Container>('container');
    expect(containers.map(container => container.Label.text).sort()).toEqual(['Discover', 'Markets']);
    const discover = containers.find(container => container.Label.text === 'Discover')!;
    const markets = containers.find(container => container.Label.text === 'Markets')!;
    // Container-in-container: Discover holds the description-as-first-child,
    // the Users leaf, and the nested Markets container.
    expect(discover.Children).toEqual([
      { kind: 'node', id: 'e2' },
      { kind: 'node', id: 'e3' },
      { kind: 'container', id: markets.id },
    ]);
    expect(markets.Children).toEqual([{ kind: 'node', id: 'e4' }]);
    expect(discover.AutoFit).toBe(true);
    expect(discover.SectionAxis).toBe('columns');

    // Consecutive top-level rows chained with unlabeled sync edges.
    const edges = ctx.graphs.current.edges();
    expect(edges).toHaveLength(4);
    expect(edges.every(edge => edge.EdgeKind === 'sync' && !edge.Label?.text)).toBe(true);
    expect(edges.map(edge => [edge.From, edge.To])).toEqual([
      ['e1', 'e2'],
      ['e2', 'e5'],
      ['e5', 'e6'],
      ['e6', 'e7'],
    ]);
  });

  it('lays children out to the right and top-level rows downward', async () => {
    const ctx = bootApp();
    await settle();
    await importDoc(ctx);

    const nodes = ctx.graphs.current.nodes();
    const byId = new Map(nodes.map(node => [node.id, node]));
    const containers = ctx.graphs.current.itemsOfKind<Container>('container');
    const discover = containers.find(container => container.Label.text === 'Discover')!;
    const markets = containers.find(container => container.Label.text === 'Markets')!;

    // Children inside a container open to the right (strictly increasing x).
    expect(byId.get('e2')!.Position!.x).toBeLessThan(byId.get('e3')!.Position!.x);
    expect(byId.get('e3')!.Position!.x).toBeLessThan(markets.Position.x);
    // The nested container's own child sits to the right of the container origin.
    expect(byId.get('e4')!.Position!.x).toBeGreaterThan(markets.Position.x - markets.Size.w / 2);

    // Top-level rows flow downward (strictly increasing y).
    const rowCenters = [byId.get('e1')!.Position!.y, discover.Position.y, byId.get('e5')!.Position!.y, byId.get('e6')!.Position!.y, byId.get('e7')!.Position!.y];
    for (let i = 1; i < rowCenters.length; i += 1) expect(rowCenters[i]).toBeGreaterThan(rowCenters[i - 1]);
  });

  it('restores the previous graph with exactly one undo', async () => {
    const ctx = bootApp();
    await settle();
    await importDoc(ctx);
    expect(ctx.graphs.current.nodes()).toHaveLength(7);
    expect(runCommand(ctx, 'history.undo')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(0);
    expect(ctx.graphs.current.itemsOfKind('container')).toHaveLength(0);
  });

  it('routes pasted markdown through the import dialog submit path', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.import.submit', { source: DOC });
    await tick();
    expect(document.querySelector('.import-preview')?.textContent).toContain('Markdown outline: 7 nodes and 4 edges');
    ctx.bus.emit('graph.import.confirm');
    await tick();
    expect(ctx.graphs.current.nodes()).toHaveLength(7);
  });
});
