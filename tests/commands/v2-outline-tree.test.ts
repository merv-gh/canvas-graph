import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';
import { snapshot } from '../../v2/core';

/** The outline is the mission-critical "nested navigation" surface. These tests
 *  assert that containment is *visible in the left pane*, not just stored —
 *  loose items stay flat, contained items nest under their parent in the unified
 *  Outline tree (containers have no standalone section), and the record/snapshot
 *  harness can see the nesting. */

const section = (id: string) => document.querySelector(`.outline-section[data-collection-id="${id}"]`);
const containerId = (ctx: ReturnType<typeof bootV2>) =>
  (ctx.graphs.current.itemsOfKind('container')[0] as { id: string }).id;

describe('v2 outline — nested navigation', () => {
  it('lists a loose node flat in the Nodes section', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const id = ctx.graphs.current.nodes()[0].id;
    const row = section('nodes')?.querySelector(`.outline-row[data-item-kind="node"][data-item-id="${id}"]`);
    expect(row).not.toBeNull();
    // A loose node is a root → it must NOT live inside a children block.
    expect(row?.closest('.outline-children')).toBeNull();
  });

  it('nests a node under its container in the unified Outline tree', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const cid = containerId(ctx);
    runCommand(ctx, 'editing.node.create');
    await settle();
    const nid = ctx.graphs.current.nodes()[0].id;

    ctx.bus.emit('container.add-child', { containerId: cid, childRef: { kind: 'node', id: nid } });
    await settle();

    // The container row owns an outline-item; the node row lives in its children.
    // Containers render inside the unified content section (data-collection-id="nodes").
    const content = section('nodes')!;
    const containerRow = content.querySelector(`.outline-row[data-item-kind="container"][data-item-id="${cid}"]`);
    expect(containerRow).not.toBeNull();
    const containerItem = containerRow!.closest('.outline-item')!;
    const childRow = containerItem.querySelector(`.outline-children .outline-row[data-item-kind="node"][data-item-id="${nid}"]`);
    expect(childRow).not.toBeNull();
    // The nested row carries the full parent chain so selecting it matches the
    // canvas element (which is tagged with data-item-parent).
    expect(childRow!.getAttribute('data-item-parent')).toContain(cid);

    // It is nested (inside a children block) and appears exactly once — not also
    // as a loose top-level row.
    const nidRows = [...document.querySelectorAll(`.outline-row[data-item-kind="node"][data-item-id="${nid}"]`)];
    expect(nidRows).toHaveLength(1);
    expect(nidRows[0].closest('.outline-children')).not.toBeNull();

    // The harness sees the deepened tree.
    expect(snapshot(ctx).ui.outline.nested).toBeGreaterThanOrEqual(1);
  });

  it('folding a container hides its nested children', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const cid = containerId(ctx);
    runCommand(ctx, 'editing.node.create');
    await settle();
    const nid = ctx.graphs.current.nodes()[0].id;
    ctx.bus.emit('container.add-child', { containerId: cid, childRef: { kind: 'node', id: nid } });
    await settle();
    expect(snapshot(ctx).ui.outline.nested).toBeGreaterThanOrEqual(1);

    ctx.bus.emit('fold.toggle', { id: `outline.item.container:${cid}` });
    await settle();

    expect(section('nodes')?.querySelector(`.outline-children .outline-row[data-item-kind="node"][data-item-id="${nid}"]`)).toBeNull();
    expect(snapshot(ctx).ui.outline.nested).toBe(0);
  });

  it('selecting a nested row drives selection + decorations through the full ref', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const cid = containerId(ctx);
    runCommand(ctx, 'editing.node.create');
    await settle();
    const nid = ctx.graphs.current.nodes()[0].id;
    ctx.bus.emit('container.add-child', { containerId: cid, childRef: { kind: 'node', id: nid } });
    await settle();

    const childMain = section('nodes')!
      .querySelector(`.outline-children .outline-row[data-item-kind="node"][data-item-id="${nid}"] .outline-main`) as HTMLElement;
    childMain.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();

    expect(ctx.selection.selected()).toEqual({ kind: 'node', id: nid, parent: [cid] });
  });
});
