import { describe, expect, it } from 'vitest';
import { snapshot } from '../../frontend/core';
import { bootApp, runCommand, settle } from './testkit';
import type { ItemRef } from '../../frontend/types';

type SectionedContainer = {
  id: string;
  Children: ItemRef[];
  Sections?: { id: string; title: string }[];
};

const containers = (ctx: ReturnType<typeof bootApp>) =>
  ctx.graphs.current.itemsOfKind<SectionedContainer>('container');

describe('node visuals and explanation maps', () => {
  it('switches node shapes from the panel and renders markdown descriptions', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.node.create');
    await settle();

    expect(snapshot(ctx).ui.toolPanels.nodeTypes.mounted).toBe(true);
    expect(runCommand(ctx, 'node.type.circle')).toBe(true);
    await settle();

    const node = ctx.graphs.current.nodes()[0];
    expect(node.NodeType).toBe('circle');
    expect(document.querySelector(`.node[data-item-id="${node.id}"]`)?.classList.contains('node-type-circle')).toBe(true);

    expect(runCommand(ctx, 'item.properties.open')).toBe(true);
    const description = document.querySelector<HTMLTextAreaElement>('.properties [data-field="description"]')!;
    description.value = '### JMM\n- **visibility** through `volatile`';
    expect(runCommand(ctx, 'properties.item.input', { target: description })).toBe(true);
    await settle();

    expect(node.Description).toContain('visibility');
    expect(document.querySelector('.node-description h4')?.textContent).toBe('JMM');
    expect(document.querySelector('.node-description strong')?.textContent).toBe('visibility');
    expect(document.querySelector('.node-description code')?.textContent).toBe('volatile');
    expect(snapshot(ctx).ui.rendered.describedNodes).toBe(1);
  });

  it('edits container sections and auto-tidies structural changes', async () => {
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
    const sections = document.querySelector<HTMLTextAreaElement>('.properties [data-field="sections"]')!;
    sections.value = 'Heap\nThread stacks\nMetaspace';
    expect(runCommand(ctx, 'properties.item.input', { target: sections })).toBe(true);
    await settle();

    expect(containers(ctx)[0].Sections?.map(section => section.title)).toEqual(['Heap', 'Thread stacks', 'Metaspace']);
    expect([...document.querySelectorAll('.container-section span')].map(el => el.textContent)).toEqual(['Heap', 'Thread stacks', 'Metaspace']);

    const beforeNestLayouts = layouts.length;
    ctx.bus.emit('container.add-child', { containerId, childRef: { kind: 'node', id: child.id } });
    await settle();
    expect(layouts.length).toBeGreaterThan(beforeNestLayouts);

    const beforeRemoveLayouts = layouts.length;
    ctx.bus.emit('container.remove-child', { childRef: { kind: 'node', id: child.id } });
    await settle();
    expect(layouts.length).toBeGreaterThan(beforeRemoveLayouts);

    const beforeDeleteLayouts = layouts.length;
    ctx.bus.emit('graph.node.delete', { id: child.id });
    await settle();
    expect(layouts.length).toBeGreaterThan(beforeDeleteLayouts);
  });

  it('renders the Java memory model demo as a verifiable explanation map', async () => {
    const ctx = bootApp();
    expect(runCommand(ctx, 'demo.render-java')).toBe(true);
    await settle();

    const snap = snapshot(ctx);
    expect(ctx.graphs.current.nodes().length).toBeGreaterThanOrEqual(9);
    expect(ctx.graphs.current.edges().length).toBeGreaterThanOrEqual(8);
    expect(containers(ctx)).toHaveLength(3);
    expect(containers(ctx).some(container => (container.Sections?.length ?? 0) >= 3)).toBe(true);
    expect(snap.ui.rendered.squareNodes).toBeGreaterThan(0);
    expect(snap.ui.rendered.circleNodes).toBeGreaterThan(0);
    expect(snap.ui.rendered.describedNodes).toBeGreaterThan(0);
    expect(snap.ui.rendered.sectionedContainers).toBeGreaterThan(0);
  });
});
