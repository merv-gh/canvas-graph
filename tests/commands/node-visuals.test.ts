import { describe, expect, it } from 'vitest';
import { snapshot } from '../../frontend/core';
import { bootApp, runCommand, settle } from './testkit';
import type { ItemRef } from '../../frontend/types';

type SectionedContainer = {
  id: string;
  Children: ItemRef[];
  Position: { x: number; y: number };
  Size: { w: number; h: number };
  Sections?: { id: string; title: string }[];
  SectionAxis?: 'rows' | 'columns';
};

const containers = (ctx: ReturnType<typeof bootApp>) =>
  ctx.graphs.current.itemsOfKind<SectionedContainer>('container');

describe('node visuals and explanation maps', () => {
  it('switches node shapes without mounting the redundant stage panel and renders markdown descriptions', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();

    expect(document.querySelector('.node-type-panel')).toBeNull();
    expect(runCommand(ctx, 'node.type.circle')).toBe(true);
    await settle();

    const node = ctx.graphs.current.nodes()[0];
    expect(node.NodeType).toBe('circle');
    expect(document.querySelector(`.node[data-item-id="${node.id}"]`)?.classList.contains('node-type-circle')).toBe(true);

    const sizeBeforeMarkdown = { ...node.Size };
    expect(runCommand(ctx, 'item.properties.open')).toBe(true);
    const description = document.querySelector<HTMLTextAreaElement>('.properties [data-field="description"]')!;
    description.value = [
      '### JMM',
      'A *memory model* [reference](https://example.com).',
      '- **visibility** through `volatile`',
      '1. publish',
      '2. observe',
      '> establishes happens-before',
      '```ts',
      'const ready = true;',
      '```',
    ].join('\n');
    expect(runCommand(ctx, 'properties.item.input', { target: description })).toBe(true);
    await settle();

    expect(node.Description).toContain('visibility');
    expect(document.querySelector('.node-description h3')?.textContent).toBe('JMM');
    expect(document.querySelector('.node-description em')?.textContent).toBe('memory model');
    expect(document.querySelector('.node-description a')?.getAttribute('href')).toBe('https://example.com');
    expect(document.querySelector('.node-description strong')?.textContent).toBe('visibility');
    expect(document.querySelector('.node-description code')?.textContent).toBe('volatile');
    expect(document.querySelectorAll('.node-description ol li')).toHaveLength(2);
    expect(document.querySelector('.node-description blockquote')?.textContent).toBe('establishes happens-before');
    expect(document.querySelector('.node-description pre code')?.textContent).toBe('const ready = true;');
    expect(node.Size.h).toBeGreaterThan(sizeBeforeMarkdown.h);
    expect(snapshot(ctx).ui.rendered.describedNodes).toBe(1);
  });

  it('limits section placement to its container without running whole-graph Tidy', async () => {
    const ctx = bootApp();
    const layouts: string[] = [];
    ctx.bus.on('layout.apply.tidy', () => layouts.push('tidy'));

    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    const [parent, child] = ctx.graphs.current.nodes();
    expect(child.Position!.y).toBeGreaterThan(parent.Position!.y);

    runCommand(ctx, 'editing.container.create');
    await settle();
    const containerId = containers(ctx)[0].id;
    expect(runCommand(ctx, 'item.properties.open')).toBe(true);
    const add = document.querySelector<HTMLElement>('[data-command="properties.sections.add"]')!;
    expect(runCommand(ctx, 'properties.sections.add', { target: add })).toBe(true);
    expect(runCommand(ctx, 'properties.sections.add', { target: add })).toBe(true);
    const sections = [...document.querySelectorAll<HTMLInputElement>('[data-section-input]')];
    ['Heap', 'Thread stacks', 'Metaspace'].forEach((title, index) => { sections[index].value = title; });
    expect(runCommand(ctx, 'properties.sections.input', { target: sections[2] })).toBe(true);
    await settle();

    expect(containers(ctx)[0].Sections?.map(section => section.title)).toEqual(['Heap', 'Thread stacks', 'Metaspace']);
    expect([...document.querySelectorAll('.container-section span')].map(el => el.textContent)).toEqual(['Heap', 'Thread stacks', 'Metaspace']);

    const parentPosition = { ...parent.Position! };
    const childPosition = { ...child.Position! };
    const beforeNestLayouts = layouts.length;
    ctx.bus.emit('container.add-child', { containerId, childRef: { kind: 'node', id: child.id } });
    await settle();
    expect(layouts.length).toBe(beforeNestLayouts);
    expect(parent.Position).toEqual(parentPosition);
    expect(child.Position).not.toEqual(childPosition);
    const nestedPosition = { ...child.Position! };

    const beforeRemoveLayouts = layouts.length;
    ctx.bus.emit('container.remove-child', { childRef: { kind: 'node', id: child.id } });
    await settle();
    expect(layouts.length).toBe(beforeRemoveLayouts);
    expect(parent.Position).toEqual(parentPosition);
    expect(child.Position).toEqual(nestedPosition);

    const beforeDeleteLayouts = layouts.length;
    ctx.bus.emit('graph.node.delete', { id: child.id });
    await settle();
    expect(layouts.length).toBe(beforeDeleteLayouts);
  });

  it('renders a nested C4 example with containers and grouping', async () => {
    const ctx = bootApp();
    expect(runCommand(ctx, 'demo.render-c4')).toBe(true);
    await settle();

    const snap = snapshot(ctx);
    expect(ctx.graphs.current.nodes().length).toBeGreaterThanOrEqual(5);
    expect(ctx.graphs.current.edges().length).toBeGreaterThanOrEqual(4);
    expect(containers(ctx)).toHaveLength(2);
    expect(containers(ctx).some(container => container.Children.some(child => child.kind === 'container'))).toBe(true);
    expect(containers(ctx).some(container => (container.Sections?.length ?? 0) >= 3)).toBe(true);
    expect(snap.ui.rendered.squareNodes).toBeGreaterThan(0);
    expect(snap.ui.rendered.circleNodes).toBeGreaterThan(0);
    expect(snap.ui.rendered.describedNodes).toBeGreaterThan(0);
    expect(snap.ui.rendered.sectionedContainers).toBeGreaterThan(0);
  });

  it('renders radial math and sequenced workflow examples', async () => {
    const ctx = bootApp();
    expect(runCommand(ctx, 'demo.render-math')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes().some(node => node.Label.text === 'Expected value')).toBe(true);
    expect(ctx.graphs.current.nodes().some(node => node.Label.text.includes('Σ'))).toBe(true);
    expect(ctx.graphs.current.edges()).toHaveLength(6);

    expect(runCommand(ctx, 'demo.render-workflow')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes().map(node => node.Label.text)).toEqual([
      'Frame the change',
      'Implement',
      'Automated checks',
      'Review',
      'Release',
    ]);
    expect(containers(ctx)[0].Sections?.map(section => section.title)).toEqual(['Frame', 'Build', 'Check', 'Release']);
    expect(ctx.graphs.current.edges().some(edge => edge.Label?.text === 'changes requested')).toBe(true);
  });
});
