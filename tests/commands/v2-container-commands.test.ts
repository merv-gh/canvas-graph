import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';
import type { Id, ItemRef } from '../../v2/types';

type ContainerLite = { id: Id; kind: 'container'; Label: { text: string }; Children: ItemRef[]; Position: { x: number; y: number } };

const containers = (ctx: ReturnType<typeof bootV2>) =>
  ctx.graphs.current.itemsOfKind<ContainerLite>('container');

describe('v2 containers', () => {
  it('creates a container, focuses it, and lists it in itemTargets', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const list = containers(ctx);
    expect(list).toHaveLength(1);
    expect(ctx.selection.selected()).toEqual({ kind: 'container', id: list[0].id });
    expect(ctx.contexts.itemTargets.all().some(t => t.ref.kind === 'container' && t.ref.id === list[0].id)).toBe(true);
  });

  it('drag-cascades children: moving a container moves nested nodes by the same delta', async () => {
    const ctx = bootV2();
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

  it('cycle guard rejects nesting a container into its own descendant', async () => {
    const ctx = bootV2();
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
    const ctx = bootV2();
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

  it('deleting a container releases its children and emits container.deleted', async () => {
    const ctx = bootV2();
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
    // Child node survives, just without a parent.
    expect(ctx.graphs.current.getNode(child.id)).toBeDefined();
  });

  it('boots with zero DX errors when container ability is fully wired', async () => {
    const ctx = bootV2();
    await settle();
    const errors = (ctx.dx?.run() ?? []).filter(i => i.level === 'error');
    expect(errors).toEqual([]);
  });
});
