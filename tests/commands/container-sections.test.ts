import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import type { Id, ItemRef } from '../../frontend/types';

type SectionedContainer = {
  id: Id;
  Position: { x: number; y: number };
  Size: { w: number; h: number };
  Sections?: { id: Id; title: string; weight: number }[];
  SectionAxis?: 'rows' | 'columns';
  ChildSections?: Record<string, Id>;
  Children: ItemRef[];
};

const containers = (ctx: ReturnType<typeof bootApp>) =>
  ctx.graphs.current.itemsOfKind<SectionedContainer>('container');
const childKey = (ref: ItemRef) => `${ref.kind}:${ref.id}`;

describe('container sections', () => {
  it('stores axis, section weights, child assignments, and lays children inside columns', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const container = containers(ctx)[0];
    ctx.bus.emit('item.update', {
      ref: { kind: 'container', id: container.id },
      patch: {
        SectionAxis: 'columns',
        Sections: [
          { id: 's1', title: 'Left lane', weight: 1 },
          { id: 's2', title: 'Right lane', weight: 1 },
        ],
      },
    });

    const left = ctx.graphs.current.createNode({ Label: { text: 'left' } });
    const right = ctx.graphs.current.createNode({ Label: { text: 'right' } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: left.id });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: right.id });
    ctx.bus.emit('container.add-child', { containerId: container.id, childRef: { kind: 'node', id: left.id }, sectionId: 's1' });
    ctx.bus.emit('container.add-child', { containerId: container.id, childRef: { kind: 'node', id: right.id }, sectionId: 's2' });
    await settle();

    expect(container.SectionAxis).toBe('columns');
    expect(container.ChildSections?.[childKey({ kind: 'node', id: left.id })]).toBe('s1');
    expect(container.ChildSections?.[childKey({ kind: 'node', id: right.id })]).toBe('s2');
    expect(ctx.graphs.current.getNode(left.id)!.Position!.x).toBeLessThan(container.Position.x);
    expect(ctx.graphs.current.getNode(right.id)!.Position!.x).toBeGreaterThan(container.Position.x);
  });

  it('edits section titles inline and drags dividers to change weights', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const container = containers(ctx)[0];
    ctx.bus.emit('item.update', {
      ref: { kind: 'container', id: container.id },
      patch: {
        SectionAxis: 'columns',
        Sections: [
          { id: 's1', title: 'Todo', weight: 1 },
          { id: 's2', title: 'Done', weight: 1 },
        ],
      },
    });
    await settle();

    ctx.bus.emit('container.section.title.edit', { containerId: container.id, sectionId: 's1' });
    await settle();
    const title = document.querySelector<HTMLElement>('[data-container-section-title][data-section-id="s1"]')!;
    expect(title.classList.contains('editing')).toBe(true);
    title.textContent = 'Ready';
    expect(runCommand(ctx, 'container.section.title.commit.enter', { target: title })).toBe(true);
    await settle();
    expect(container.Sections?.[0].title).toBe('Ready');

    const before = container.Sections!.map(section => section.weight);
    ctx.bus.emit('container.section.resize.start', { containerId: container.id, index: 0, x: container.Position.x, y: container.Position.y });
    ctx.bus.emit('container.section.resize.move', { x: container.Position.x + 80, y: container.Position.y });
    ctx.bus.emit('container.section.resize.end');
    await settle();
    expect(container.Sections![0].weight).toBeGreaterThan(before[0]);
    expect(container.Sections![1].weight).toBeLessThan(before[1]);
  });

  it('opens node context actions for section moves and exposes text layout', async () => {
    const ctx = bootApp();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const container = containers(ctx)[0];
    ctx.bus.emit('item.update', {
      ref: { kind: 'container', id: container.id },
      patch: {
        Sections: [
          { id: 's1', title: 'A', weight: 1 },
          { id: 's2', title: 'B', weight: 1 },
        ],
      },
    });
    const node = ctx.graphs.current.createNode({ Label: { text: 'move me' } });
    ctx.bus.emit('graph.node.created', { graphId: ctx.graphs.current.id, id: node.id });
    ctx.bus.emit('container.add-child', { containerId: container.id, childRef: { kind: 'node', id: node.id }, sectionId: 's1' });
    ctx.bus.emit('selection.node.select', { id: node.id });
    await settle();

    expect(document.querySelector('.node-context-actions')).not.toBeNull();
    expect(runCommand(ctx, 'item.context.open')).toBe(true);
    await settle();
    expect(document.querySelector('.context-actions')?.textContent).toContain('Move to section');
    const target = [...document.querySelectorAll<HTMLElement>('.context-action')]
      .find(button => button.textContent === 'B')!;
    expect(runCommand(ctx, 'container.child.section.set', { target })).toBe(true);
    await settle();
    expect(container.ChildSections?.[childKey({ kind: 'node', id: node.id })]).toBe('s2');

    expect(ctx.textLayout?.estimate({ title: 'A long Java Memory Model node' }).w).toBeGreaterThan(112);
    expect(ctx.textLayout?.fit('volatile write publishes visibility', { w: 120, h: 60 }).fontSize).toBeGreaterThan(0);
  });
});
