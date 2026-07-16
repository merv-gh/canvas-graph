import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';
import type { Id, ItemRef } from '../../frontend/types';
import { itemFoldId } from '../../frontend/core';

type ContainerLite = { id: Id; kind: 'container'; Label: { text: string }; Children: ItemRef[]; Position: { x: number; y: number } };

const containers = (ctx: ReturnType<typeof bootApp>) =>
  ctx.graphs.current.itemsOfKind<ContainerLite>('container');

describe('frontend containers', () => {
  it('creates a container, focuses it, and lists it in hierarchy targets', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const list = containers(ctx);
    expect(list).toHaveLength(1);
    expect(ctx.selection.selected()).toEqual({ kind: 'container', id: list[0].id });
    expect(ctx.contexts.hierarchy.targets().some(t => t.ref.kind === 'container' && t.ref.id === list[0].id)).toBe(true);
  });

  it('unfolds a collapsed container on double-click with maximize and minimize icons', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const container = containers(ctx)[0];
    const ref = { kind: 'container', id: container.id } as const;
    const foldId = itemFoldId(ref, ctx.graphs.current.id);
    ctx.contexts.fold.set(foldId, false);
    await settle();

    const collapsed = document.querySelector<HTMLElement>(`.container.collapsed[data-item-id="${container.id}"]`)!;
    expect(collapsed).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('.item-toolbar [data-command="item.collapse.toggle"]')?.textContent).toBe('⊞');
    expect(runCommand(ctx, 'item.collapse.open.dblclick', { target: collapsed })).toBe(true);
    await settle();

    expect(ctx.contexts.fold.isOpen(foldId)).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('.item-toolbar [data-command="item.collapse.toggle"]')?.textContent).toBe('⊟');
  });

  it('drag-cascades children: moving a container moves nested nodes by the same delta', async () => {
    const ctx = bootApp();
    await settle();

    // Two nodes + one container — keep ids stable by creating in order.
    runCommand(ctx, 'editing.container.create');
    await settle();
    const containerId = containers(ctx)[0].id;
    const childNode = ctx.graphs.current.createNode({ Label: { text: 'child' }, Position: { x: 100, y: 100 } });

    // Nest the node into the container directly via the bus event (no picker).
    ctx.bus.emit('container.add-child', { containerId, childRef: { kind: 'node', id: childNode.id } });
    await settle();
    expect(containers(ctx)[0].Children).toContainEqual({ kind: 'node', id: childNode.id });

    // Drag-cascade: emit a container Position patch and verify the child moved with it.
    const before = ctx.graphs.current.getNode(childNode.id)!.Position!;
    ctx.bus.emit('item.update', {
      ref: { kind: 'container', id: containerId },
      patch: { Position: { x: containers(ctx)[0].Position.x + 50, y: containers(ctx)[0].Position.y + 30 } },
    });
    await settle();
    const after = ctx.graphs.current.getNode(childNode.id)!.Position!;
    expect(after.x - before.x).toBe(50);
    expect(after.y - before.y).toBe(30);
  });

  it('resizes from the bottom-right while keeping top-left fixed', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const container = containers(ctx)[0];
    const topLeft = {
      x: container.Position.x - 320 / 2,
      y: container.Position.y - 200 / 2,
    };

    ctx.bus.emit('resize.item.start', {
      ref: { kind: 'container', id: container.id },
      x: container.Position.x + 160,
      y: container.Position.y + 100,
    });
    ctx.bus.emit('resize.item.move', { x: container.Position.x + 260, y: container.Position.y + 160 });
    ctx.bus.emit('resize.item.end');
    await settle();

    expect(container.Size).toEqual({ w: 420, h: 260 });
    expect(Math.round(container.Position.x - container.Size.w / 2)).toBe(Math.round(topLeft.x));
    expect(Math.round(container.Position.y - container.Size.h / 2)).toBe(Math.round(topLeft.y));
    expect(container.AutoFit).toBe(false);
  });

  it('cycle guard rejects nesting a container into its own descendant', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const [a, b] = containers(ctx).map(c => c.id);

    // a parents b.
    ctx.bus.emit('container.add-child', { containerId: a, childRef: { kind: 'container', id: b } });
    await settle();
    expect(containers(ctx).find(c => c.id === a)!.Children).toContainEqual({ kind: 'container', id: b });

    // Attempt the cycle: nest a under b — should refuse without throwing.
    ctx.bus.emit('container.add-child', { containerId: b, childRef: { kind: 'container', id: a } });
    await settle();
    expect(containers(ctx).find(c => c.id === b)!.Children).not.toContainEqual({ kind: 'container', id: a });
  });

  it('remove-child detaches the ref and unfocuses the parent linkage', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const containerId = containers(ctx)[0].id;
    const child = ctx.graphs.current.createNode({ Label: { text: 'child' } });
    ctx.bus.emit('container.add-child', { containerId, childRef: { kind: 'node', id: child.id } });
    await settle();

    ctx.bus.emit('container.remove-child', { childRef: { kind: 'node', id: child.id } });
    await settle();
    expect(containers(ctx)[0].Children).toHaveLength(0);
  });

  it('deleting a container deletes its child nodes and emits container.deleted', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const containerId = containers(ctx)[0].id;
    const child = ctx.graphs.current.createNode({ Label: { text: 'child' }, Position: { x: 50, y: 50 } });
    ctx.bus.emit('container.add-child', { containerId, childRef: { kind: 'node', id: child.id } });
    await settle();

    const deletedFired: string[] = [];
    ctx.bus.on('container.deleted', ({ id }) => { deletedFired.push(id); });

    ctx.bus.emit('graph.container.delete', { id: containerId });
    await settle();

    expect(deletedFired).toEqual([containerId]);
    expect(containers(ctx)).toHaveLength(0);
    expect(ctx.graphs.current.getNode(child.id)).toBeUndefined();
  });

  it('warns before deleting nested contents and offers a keep-contents path', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    const containerId = containers(ctx)[0].id;
    const child = ctx.graphs.current.createNode({ Label: { text: 'child' } });
    ctx.bus.emit('container.add-child', { containerId, childRef: { kind: 'node', id: child.id } });
    await settle();

    ctx.bus.emit('selection.item.select', { kind: 'container', id: containerId });
    expect(runCommand(ctx, 'container.delete.request', { origin: 'pointer' })).toBe(true);
    await settle();
    expect(document.querySelector('.container-delete-preview')?.textContent).toContain('1 node');
    expect(document.querySelector('.container-delete-preview')?.textContent).toContain('Ungroup and keep contents');
    expect(ctx.graphs.current.getNode(child.id)).not.toBeUndefined();

    expect(runCommand(ctx, 'container.delete.cancel')).toBe(true);
    await settle();
    expect(containers(ctx)).toHaveLength(1);
    expect(runCommand(ctx, 'container.ungroup')).toBe(true);
    await settle();
    expect(containers(ctx)).toHaveLength(0);
    expect(ctx.graphs.current.getNode(child.id)).not.toBeUndefined();
  });

  it('boots with zero DX errors when container ability is fully wired', async () => {
    const ctx = bootApp();
    await settle();
    const errors = (ctx.dx?.run() ?? []).filter(i => i.level === 'error');
    expect(errors).toEqual([]);
  });
});
