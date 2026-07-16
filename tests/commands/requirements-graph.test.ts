import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemFoldId, memoryIo } from '../../frontend/core';
import { bootApp, runCommand, settle } from './testkit';

const root = resolve(import.meta.dirname, '../..');

describe('requirements graph tool', () => {
  it('maps every Capability into one Attribute container and Component section', async () => {
    const { parseRequirements, buildRequirementsGraph } = await import('../../tools/requirements-graph.mjs');
    const markdown = readFileSync(resolve(root, 'requirements/requirements.md'), 'utf8');
    const model = parseRequirements(markdown);
    const graph = buildRequirementsGraph(model) as any;
    const containers = graph.extensions.containers as any[];

    expect(model.attributes).toHaveLength(9);
    expect(model.components).toHaveLength(20);
    expect(model.capabilities.length).toBeGreaterThan(200);
    expect(model.blockers.length).toBeGreaterThan(0);
    expect(model.evidence).toHaveLength(27);
    expect(containers).toHaveLength(model.attributes.length + 1);
    expect(graph.nodes).toHaveLength(model.capabilities.length + model.attributes.length + 1);
    expect(new Set(graph.nodes.map((node: any) => node.id)).size).toBe(graph.nodes.length);

    const children = containers.flatMap(container => container.Children);
    expect(children).toHaveLength(graph.nodes.length + model.attributes.length);
    expect(new Set(children.map((child: any) => `${child.kind}:${child.id}`)).size).toBe(children.length);
    const rootContainer = containers.find(container => container.id === graph.extensions.requirementsMap.rootContainerId);
    const metadata = graph.extensions.requirementsMap;
    expect(metadata.version).toBe(3);
    expect(Object.keys(metadata.capabilities)).toHaveLength(model.capabilities.length);
    expect(metadata.evidenceCoverage).toEqual({
      status: 'partial', accepted: 25, required: 212, unproven: 187,
      missing: 187, pending: 0, rejected: 0, stale: 0, records: 27,
    });
    expect(Object.values(metadata.capabilities).filter((capability: any) => capability.evidenceState === 'accepted')).toHaveLength(25);
    expect(Object.values(metadata.capabilities).filter((capability: any) => capability.evidenceState === 'pending')).toHaveLength(0);
    expect(graph.nodes.find((node: any) => node.id === metadata.capabilityNodes['CAP-C17-A08-03']).Description)
      .toContain('Evidence: accepted · EVD-001');
    expect(graph.nodes.find((node: any) => node.id === metadata.capabilityNodes['CAP-C04-A01-06']).Description)
      .toContain('Evidence: accepted · EVD-018');
    expect(rootContainer.Children.filter((child: any) => child.kind === 'container')).toHaveLength(model.attributes.length);
    expect(rootContainer.Children).toContainEqual({ kind: 'node', id: graph.extensions.requirementsMap.missionNodeId });
    containers.filter(container => container.id !== rootContainer.id).forEach(container => {
      expect(container.Sections[0].title).toBe('Attribute definition');
      expect(container.Sections.slice(1).every((section: any) => /^C\d{2} · /.test(section.title))).toBe(true);
      container.Children.forEach((child: any) => {
        expect(container.ChildSections[`node:${child.id}`]).toBeTruthy();
      });
    });

    const generated = JSON.parse(readFileSync(resolve(root, 'requirements/requirements.graph.json'), 'utf8'));
    expect(generated).toEqual(graph);
  });

  it('imports as a rendered Canvas Graph document with Attribute containers', async () => {
    const graph = JSON.parse(readFileSync(resolve(root, 'requirements/requirements.graph.json'), 'utf8'));
    const counts = graph.extensions.requirementsMap.counts;
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.import.snapshot', graph);
    await settle();

    expect(ctx.graphs.current.name).toBe('Requirements map');
    expect(ctx.graphs.current.nodes()).toHaveLength(counts.capabilities + counts.attributes + 1);
    expect(ctx.graphs.current.itemsOfKind('container')).toHaveLength(counts.attributes + 1);
    const metadata = graph.extensions.requirementsMap;
    expect(metadata.evidenceCoverage).toEqual({
      status: 'partial', accepted: 25, required: counts.releaseCapabilities, unproven: 187,
      missing: 187, pending: 0, rejected: 0, stale: 0, records: 27,
    });
    expect(document.querySelector('.shell')?.getAttribute('data-requirements-map')).toBe('true');
    expect(ctx.contexts.fold.isOpen(itemFoldId({ kind: 'container', id: metadata.rootContainerId }, ctx.graphs.current.id))).toBe(true);
    metadata.defaultFoldedContainerIds.forEach((id: string) => {
      expect(ctx.contexts.fold.folded(itemFoldId({ kind: 'container', id }, ctx.graphs.current.id))).toBe(true);
    });
    expect(document.querySelectorAll('.container.collapsed')).toHaveLength(counts.attributes);
    expect(document.querySelectorAll('.container.has-sections')).toHaveLength(0);
    expect(document.querySelectorAll('.node')).toHaveLength(1);
    expect(document.querySelector('.node')?.getAttribute('aria-label')).toContain('read-only generated requirement card');
    expect(document.querySelector('.node')?.getAttribute('aria-label')).not.toContain('Press Enter to edit');

    const first = metadata.attributeContainers[0];
    ctx.contexts.fold.set(itemFoldId({ kind: 'container', id: first.containerId }, ctx.graphs.current.id), true);
    await settle();
    expect(document.querySelectorAll('.container.has-sections')).toHaveLength(1);
    expect(document.querySelectorAll('.node').length).toBeGreaterThan(1);
    expect(document.querySelectorAll('.node').length).toBeLessThan(first.capabilityIds.length + 2); // viewport culling remains active

    const second = metadata.attributeContainers[1];
    ctx.contexts.fold.set(itemFoldId({ kind: 'container', id: second.containerId }, ctx.graphs.current.id), true);
    await settle();
    expect(ctx.contexts.fold.folded(itemFoldId({ kind: 'container', id: first.containerId }, ctx.graphs.current.id))).toBe(true);
    expect(ctx.contexts.fold.isOpen(itemFoldId({ kind: 'container', id: second.containerId }, ctx.graphs.current.id))).toBe(true);

    const beforeMutation = ctx.graphs.current.nodes().length;
    expect(runCommand(ctx, 'editing.node.create')).toBe(false);
    expect(ctx.graphs.current.nodes()).toHaveLength(beforeMutation);
  });

  it('filters the review index by accepted evidence, Attribute, and Component without flattening hierarchy', async () => {
    const graph = JSON.parse(readFileSync(resolve(root, 'requirements/requirements.graph.json'), 'utf8'));
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.import.snapshot', graph);
    await settle();
    document.querySelector<HTMLElement>('[data-fold-id="outline.panel"]')?.click();
    await settle();

    const setFilter = async (key: string, value: string) => {
      const select = document.querySelector<HTMLSelectElement>(`[data-requirements-filter="${key}"]`)!;
      select.value = value;
      expect(runCommand(ctx, 'outline.requirements.filter.change', { target: select })).toBe(true);
      await settle();
    };
    await setFilter('attribute', 'A08');
    await setFilter('component', 'C17');
    await setFilter('readiness', 'proven');

    const groups = [...document.querySelectorAll<HTMLElement>('.requirements-nav-attribute')];
    expect(groups).toHaveLength(1);
    expect(groups[0].textContent).toContain('A08 · Extensible');
    expect(groups[0].textContent).toContain('3/15 shown');
    const rows = [...groups[0].querySelectorAll<HTMLElement>('.requirements-nav-capability')];
    expect(rows.map(row => row.querySelector('strong')?.textContent)).toEqual([
      'CAP-C17-A08-03 · 0.1',
      'CAP-C17-A08-04 · 0.1',
      'CAP-C17-A08-05 · 0.1',
    ]);
    expect(rows.every(row => row.dataset.evidenceState === 'accepted')).toBe(true);
    expect(rows.every(row => row.textContent?.includes('proof accepted'))).toBe(true);
    await settle();
    expect(document.querySelector('.shell')?.getAttribute('data-requirements-filtered')).toBe('true');
    expect(document.querySelectorAll('.node[data-requirements-match="true"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.node[data-requirements-match="false"]').length).toBeGreaterThan(0);
    expect(document.querySelector('.requirements-nav-filter-note')?.textContent).toContain('context dims');
    await new Promise(resolve => setTimeout(resolve, 240));
    await settle();
    expect(ctx.contexts.view.get().scale).toBeGreaterThanOrEqual(0.7);
  });

  it('restores the generated projection with its stage and Attribute index after a browser save', async () => {
    const graph = JSON.parse(readFileSync(resolve(root, 'requirements/requirements.graph.json'), 'utf8'));
    const io = memoryIo();
    const first = bootApp({ autoLayout: false }, io);
    first.bus.emit('graph.import.snapshot', graph);
    const firstAttributeId = graph.extensions.requirementsMap.attributeContainers[0].containerId;
    first.contexts.fold.set(itemFoldId({ kind: 'container', id: firstAttributeId }, first.graphs.current.id), true);
    await new Promise(resolve => setTimeout(resolve, 360));
    await settle();

    const restored = bootApp({ autoLayout: false }, io);
    await settle();
    expect(restored.graphs.current.snapshotExtension<any>('requirementsMap')?.version).toBe(3);
    expect(restored.graphs.current.nodes()).toHaveLength(graph.nodes.length);
    expect(document.querySelectorAll('.container.collapsed')).toHaveLength(8);
    expect(document.querySelectorAll('.node').length).toBeGreaterThan(1);
    document.querySelector<HTMLElement>('[data-fold-id="outline.panel"]')?.click();
    await settle();
    expect(document.querySelectorAll('.requirements-nav-attribute')).toHaveLength(9);
  });

  it('rejects accepted evidence without a dated proof locator', async () => {
    const { parseRequirements } = await import('../../tools/requirements-graph.mjs');
    const markdown = readFileSync(resolve(root, 'requirements/requirements.md'), 'utf8');
    const invalid = `${markdown}\n| EVD-999 | CAP-C17-A08-03 | automated | accepted | — | — | Invalid proof |\n`;
    expect(() => parseRequirements(invalid)).toThrow('EVD-999 is accepted without a proof locator');
  });

  it('searches ordinary node descriptions in the graph navigator', async () => {
    const ctx = bootApp({ autoLayout: false });
    ctx.graphs.current.createNode({
      Label: { text: 'Worker' },
      Description: 'Retries failed jobs with a bounded latency budget sentinel.',
      Position: { x: 450, y: 300 },
    });
    await settle();
    document.querySelector<HTMLElement>('[data-fold-id="outline.panel"]')?.click();
    await settle();
    const search = document.querySelector<HTMLInputElement>('[data-graph-nav-search]')!;
    search.value = 'latency budget sentinel';
    expect(runCommand(ctx, 'outline.search.change', { target: search })).toBe(true);
    await settle();

    const result = document.querySelector<HTMLElement>('.graph-nav-current .graph-nav-item[data-item-kind="node"]');
    expect(result?.textContent).toContain('Worker');
    expect(result?.textContent).toContain('latency budget sentinel');
  });

  it('searches and top-aligns Component sections as jumpable navigator results', async () => {
    const graph = JSON.parse(readFileSync(resolve(root, 'requirements/requirements.graph.json'), 'utf8'));
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.import.snapshot', graph);
    await settle();
    document.querySelector<HTMLElement>('[data-fold-id="outline.panel"]')?.click();
    await settle();
    const search = document.querySelector<HTMLInputElement>('[data-graph-nav-search]')!;
    search.value = 'C14 · Storage and history';
    expect(runCommand(ctx, 'outline.search.change', { target: search })).toBe(true);
    await settle();

    const result = document.querySelector<HTMLElement>('.requirements-nav-section[data-section-id]')!;
    expect(result.textContent).toContain('C14 · Storage and history');
    const containerId = result.dataset.containerId!;
    const sectionId = result.dataset.sectionId!;
    expect(runCommand(ctx, 'outline.section.open', { target: result })).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 240));
    await settle();

    expect(ctx.selection.selected()).toEqual({ kind: 'container', id: containerId });
    expect(ctx.contexts.view.get().scale).toBeGreaterThanOrEqual(0.8);
    const container = ctx.graphs.current.getItem<any>({ kind: 'container', id: containerId })!;
    const sections = container.Sections as Array<{ id: string; weight: number }>;
    const index = sections.findIndex(section => section.id === sectionId);
    const weights = sections.map(section => Math.max(0.15, section.weight ?? 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const before = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0) / total;
    const sectionTop = container.Position.y - container.Size.h / 2 + container.Size.h * before;
    expect(ctx.contexts.view.spaceToScreen({ x: container.Position.x, y: sectionTop }).y).toBeCloseTo(72, 0);
    expect(document.querySelectorAll('.node[data-requirements-match="true"]').length).toBeGreaterThan(0);
  });

  it('searches human Capability prose and opens a result at readable scale', async () => {
    const graph = JSON.parse(readFileSync(resolve(root, 'requirements/requirements.graph.json'), 'utf8'));
    const ctx = bootApp({ autoLayout: false });
    ctx.bus.emit('graph.import.snapshot', graph);
    await settle();

    document.querySelector<HTMLElement>('[data-fold-id="outline.panel"]')?.click();
    await settle();
    const search = document.querySelector<HTMLInputElement>('[data-graph-nav-search]')!;
    search.value = 'keyboard shortcuts can continue';
    expect(runCommand(ctx, 'outline.search.change', { target: search })).toBe(true);
    await settle();
    const result = document.querySelector<HTMLElement>('.requirements-nav-capability[data-item-kind="node"]')!;
    expect(result.textContent).toContain('CAP-C11-A02-05');
    expect(result.textContent).toContain('keyboard shortcuts can continue');

    ctx.contexts.view.set({ x: 0, y: 0, scale: 0.06 });
    expect(runCommand(ctx, 'outline.item.open', { target: result })).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 240));
    await settle();
    const selected = ctx.selection.selected();
    expect(selected?.kind).toBe('node');
    expect(ctx.contexts.view.get().scale).toBeGreaterThanOrEqual(0.7);
    const ancestor = ctx.contexts.hierarchy.parentChain(selected!)[0];
    expect(ctx.contexts.fold.isOpen(itemFoldId(ancestor, ctx.graphs.current.id))).toBe(true);
  });
});
