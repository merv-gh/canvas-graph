import { describe, expect, it } from 'vitest';
import { itemFoldId } from '../../frontend/core';
import { bootApp, runCommand, settle } from './testkit';

const panel = () => document.querySelector<HTMLElement>('.tool-panel[data-panel-id="context"]');
const properties = () => document.querySelector<HTMLElement>('.tool-panel[data-panel-id="properties"]');
const action = (command: string) => panel()?.querySelector<HTMLElement>(`[data-command="${command}"]`);
const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('context panel', () => {
  it('stays out of the way until something is selected', async () => {
    bootApp();
    await settle();
    expect(panel()).toBeNull();
  });

  it('lists selected items vertically and exposes single-item actions', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.node.create', { Label: { text: 'API' } });
    await settle();
    const apiId = ctx.graphs.current.nodes()[0].id;
    const peer = ctx.graphs.current.createNode({ Label: { text: 'Peer' } });
    ctx.bus.emit('graph.edge.create', { From: apiId, To: peer.id, Label: { text: 'calls' } });
    const edgeId = ctx.graphs.current.edges()[0].id;

    expect(panel()).toBeNull();
    expect(properties()).not.toBeNull();
    const title = properties()?.querySelector<HTMLInputElement>('[data-item-modal-title]');
    expect(title?.value).toBe('API');
    expect(properties()?.querySelector('[data-command="selection.group"]')?.textContent).toContain('Group');
    expect(properties()?.querySelector('[data-command="node.convert.container"]')?.textContent).toContain('Convert');
    expect(properties()?.querySelector('[data-command="selection.item.delete"]')?.textContent).toContain('Delete');
    expect(properties()?.querySelector('.context-action-card strong')).toBeNull();
    expect(properties()?.querySelector('.context-action-label')).not.toBeNull();

    title!.value = 'Gateway';
    title!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(ctx.graphs.current.nodes()[0].Label.text).toBe('Gateway');

    expect(runCommand(ctx, 'node.convert.container')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    const converted = ctx.graphs.current.itemsOfKind<{ id: string; Label: { text: string }; Size: { w: number; h: number } }>('container');
    expect(converted).toHaveLength(1);
    expect(converted[0].Label.text).toBe('Gateway');
    expect(converted[0].Size).toMatchObject({ w: 220, h: 140 });
    expect(ctx.graphs.current.edges()).toHaveLength(1);
    expect(ctx.graphs.current.edges()[0]).toMatchObject({ id: edgeId, From: converted[0].id, To: peer.id, Label: { text: 'calls' } });
  });

  it('offers obvious group and delete actions for a multi-selection', async () => {
    const ctx = bootApp();
    await settle();
    const a = ctx.graphs.current.createNode({ Label: { text: 'Web' } });
    const b = ctx.graphs.current.createNode({ Label: { text: 'API' } });
    ctx.bus.emit('selection.choose', {
      refs: [{ kind: 'node', id: a.id }, { kind: 'node', id: b.id }],
      mode: 'replace',
    });
    await settle();

    expect(panel()?.querySelectorAll('.context-selection-item')).toHaveLength(2);
    expect(action('selection.group')?.textContent).toBe('Group selected');
    expect(action('selection.item.delete')?.textContent).toBe('Delete selected');
    expect(runCommand(ctx, 'selection.group')).toBe(true);
    await settle();
    const groups = ctx.graphs.current.itemsOfKind<{ Children: unknown[] }>('container');
    expect(groups).toHaveLength(1);
    expect(groups[0].Children).toHaveLength(2);
  });

  it('offers drawing selection once ink exists', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'ink.toggle');
    ctx.bus.emit('ink.stroke.start', { point: { x: 10, y: 10 } });
    ctx.bus.emit('ink.stroke.move', { point: { x: 40, y: 30 } });
    ctx.bus.emit('ink.stroke.end');
    await settle();

    expect(panel()).toBeNull();
    expect(runCommand(ctx, 'ink.select.all')).toBe(true);
    expect(ctx.selection.selectedAll()).toEqual([{ kind: 'ink', id: 'k1' }]);
  });

  it('creates a palette type from single or multiple selected nodes without changing them', async () => {
    const ctx = bootApp();
    await settle();
    const a = ctx.graphs.current.createNode({ Label: { text: 'API' }, NodeType: 'square', Color: 'blue', Fill: 'soft' });
    const b = ctx.graphs.current.createNode({ Label: { text: 'Worker' }, NodeType: 'service', Color: 'purple', Fill: 'solid', BorderColor: 'red' });
    ctx.bus.emit('selection.choose', {
      refs: [{ kind: 'node', id: a.id }, { kind: 'node', id: b.id }], mode: 'replace',
    });
    await settle();

    expect(action('palette.custom-type.create')?.textContent).toBe('Create type from selection');
    click(action('palette.custom-type.create')!);
    await settle();
    expect(document.querySelector<HTMLInputElement>('[data-form-field="label"]')?.value).toBe('Worker');
    expect(document.querySelector<HTMLSelectElement>('[data-form-field="shape"]')?.value).toBe('service');
    const name = document.querySelector<HTMLInputElement>('[data-form-field="label"]')!;
    name.value = 'Background worker';
    expect(runCommand(ctx, 'commandForm.submit', {
      target: document.querySelector<HTMLElement>('[data-command="commandForm.submit"]')!,
    })).toBe(true);
    ctx.contexts.fold.set('outline.panel', true);
    await settle();

    expect(document.querySelector('[data-palette-custom-type]')?.textContent).toContain('Background worker');
    expect(ctx.graphs.current.getNode(a.id)).toMatchObject({ NodeType: 'square', Color: 'blue', Fill: 'soft' });
    expect(ctx.graphs.current.getNode(b.id)).toMatchObject({ NodeType: 'service', Color: 'purple', Fill: 'solid', BorderColor: 'red' });

    ctx.selection.select({ kind: 'node', id: a.id });
    await settle();
    expect(properties()?.querySelector('[data-command="palette.custom-type.create"]')?.textContent).toContain('Save as type');
  });

  it('offers state-aware fold and unfold for a selected container', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const container = ctx.graphs.current.itemsOfKind<{ id: string }>('container')[0]!;
    const ref = { kind: 'container' as const, id: container.id };
    ctx.selection.select(ref);
    await settle();

    expect(properties()?.querySelector('[data-command="item.collapse.toggle"]')?.textContent).toContain('Fold / unfold');
    expect(properties()?.querySelector('[data-command="container.convert.node"]')?.textContent).toContain('Convert to node');
    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(true);
    await settle();
    expect(ctx.contexts.fold.folded(itemFoldId(ref, ctx.graphs.current.id))).toBe(true);

    expect(runCommand(ctx, 'item.collapse.toggle')).toBe(true);
    await settle();
    expect(ctx.contexts.fold.folded(itemFoldId(ref, ctx.graphs.current.id))).toBe(false);
  });

  it('converts a container to a node without deleting its contents', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('editing.container.create', {
      Label: { text: 'Boundary' }, at: { x: 40, y: 60 }, Size: { w: 260, h: 160 }, Color: 'purple',
    });
    await settle();
    const container = ctx.graphs.current.itemsOfKind<{ id: string }>('container')[0]!;
    ctx.bus.emit('graph.node.create', { Label: { text: 'Child' } });
    await settle();
    const child = ctx.graphs.current.nodes()[0]!;
    const peer = ctx.graphs.current.createNode({ Label: { text: 'Peer' } });
    ctx.bus.emit('container.add-child', { containerId: container.id, childRef: { kind: 'node', id: child.id } });
    ctx.bus.emit('graph.edge.create', { From: peer.id, To: container.id, Label: { text: 'owns' } });
    const edgeId = ctx.graphs.current.edges()[0].id;
    await settle();
    ctx.selection.select({ kind: 'container', id: container.id });

    expect(runCommand(ctx, 'container.convert.node')).toBe(true);
    await settle();

    expect(ctx.graphs.current.itemsOfKind('container')).toHaveLength(0);
    expect(ctx.graphs.current.nodes()).toHaveLength(3);
    expect(ctx.graphs.current.getNode(child.id)).toBeTruthy();
    const converted = ctx.graphs.current.nodes().find(node => node.id !== child.id && node.id !== peer.id)!;
    expect(converted).toMatchObject({
      Label: { text: 'Boundary' }, Position: { x: 40, y: 60 }, NodeType: 'square', Color: 'purple',
    });
    expect(ctx.graphs.current.edges()).toHaveLength(1);
    expect(ctx.graphs.current.edges()[0]).toMatchObject({ id: edgeId, From: peer.id, To: converted.id, Label: { text: 'owns' } });
  });
});
