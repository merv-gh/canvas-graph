import { describe, expect, it } from 'vitest';
import { memoryIo, STORAGE_KEYS } from '../../frontend/core';
import { bootApp, runCommand, settle } from './testkit';

/** Graph persistence: the io system saves every graph on graph.* facts
 *  (debounced, flushed on pagehide) and restores them on the next boot's
 *  app.start. Two boots sharing one IoApi simulate a reload. */

const flushPersist = () => window.dispatchEvent(new Event('pagehide'));

describe('graph persistence (io system)', () => {
  it('restores nodes and edges across a reboot with the same io', async () => {
    const io = memoryIo();
    const first = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    runCommand(first, 'editing.node.create');
    await settle();
    runCommand(first, 'editing.node.create'); // chains an edge from the first
    await settle();
    expect(first.graphs.current.nodes()).toHaveLength(2);
    expect(first.graphs.current.edges()).toHaveLength(1);
    const savedTitle = first.graphs.current.nodes()[0].Label.text;
    flushPersist();
    expect(io.get(STORAGE_KEYS.graphs, null)).not.toBeNull();

    const second = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    expect(second.graphs.current.nodes()).toHaveLength(2);
    expect(second.graphs.current.edges()).toHaveLength(1);
    expect(second.graphs.current.nodes()[0].Label.text).toBe(savedTitle);
  }, 15000);

  it('restores containers, sections, and nesting across a reboot', async () => {
    const io = memoryIo();
    const flags = { dx: false, demo: false, debug: false, autoLayout: false };
    const first = bootApp(flags, io);
    await settle();
    first.bus.emit('graph.node.create', { Label: { text: 'API' } });
    first.bus.emit('editing.container.create', { Label: { text: 'System' }, at: { x: 40, y: 50 } });
    await settle();
    first.bus.emit('container.add-child', { containerId: 'c1', childRef: { kind: 'node', id: 'e1' }, sectionId: 's1' });
    first.bus.emit('item.update', {
      ref: { kind: 'container', id: 'c1' },
      patch: {
        Position: { x: 120, y: 80 }, Size: { w: 640, h: 360 }, AutoFit: false,
        Sections: [{ id: 's1', title: 'Runtime', weight: 1 }],
        SectionAxis: 'columns', ChildSections: { 'node:e1': 's1' },
      },
    });
    await settle();
    flushPersist();

    const second = bootApp(flags, io);
    await settle();
    const [container] = second.graphs.current.itemsOfKind<any>('container');
    expect(container).toMatchObject({
      id: 'c1', Label: { text: 'System' }, Position: { x: 120, y: 80 },
      Size: { w: 640, h: 360 }, AutoFit: false, SectionAxis: 'columns',
    });
    expect(container.Sections).toEqual([{ id: 's1', title: 'Runtime', weight: 1 }]);
    expect(container.Children).toEqual([{ kind: 'node', id: 'e1' }]);
    expect(container.ChildSections['node:e1']).toBe('s1');
  }, 15000);

  it('restores multiple graphs and the active graph id', async () => {
    const io = memoryIo();
    const first = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    runCommand(first, 'editing.node.create');
    await settle();
    first.bus.emit('graph.create');
    await settle();
    runCommand(first, 'editing.node.create');
    runCommand(first, 'editing.node.create');
    await settle();
    const activeId = first.graphs.current.id;
    first.bus.emit('graph.rename', { id: activeId, name: 'Release map' });
    await settle();
    expect(first.graphs.all()).toHaveLength(2);
    flushPersist();

    const second = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    expect(second.graphs.all()).toHaveLength(2);
    expect(second.graphs.current.id).toBe(activeId);
    expect(second.graphs.current.name).toBe('Release map');
    expect(second.graphs.current.nodes()).toHaveLength(2);
  }, 15000);

  it('keeps a chosen oversized demo top-aligned and leading-edge safe after a reboot', async () => {
    const io = memoryIo();
    const flags = { dx: false, debug: false, autoLayout: false };
    const first = bootApp(flags, io);
    await settle();
    first.bus.emit('demo.run-math');
    await settle();
    expect(first.graphs.current.nodes()).toHaveLength(7);
    flushPersist();

    const second = bootApp(flags, io);
    await settle();
    const nodes = second.graphs.current.nodes();
    expect(nodes).toHaveLength(7);
    const minX = Math.min(...nodes.map(node => node.Position!.x - node.Size.w / 2));
    const maxX = Math.max(...nodes.map(node => node.Position!.x + node.Size.w / 2));
    const minY = Math.min(...nodes.map(node => node.Position!.y - node.Size.h / 2));
    const leadingTop = second.contexts.view.spaceToScreen({ x: minX, y: minY });
    expect(leadingTop.x).toBeCloseTo(72, 4);
    expect(leadingTop.y).toBeCloseTo(72, 4);
    expect(second.contexts.view.get().scale).toBeGreaterThanOrEqual(0.8);
  }, 15000);

  it('debounce writes without pagehide after the delay', async () => {
    const io = memoryIo();
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(io.get(STORAGE_KEYS.graphs, null)).toBeNull(); // still pending
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(io.get(STORAGE_KEYS.graphs, null)).not.toBeNull();
  }, 15000);

  it('reports rejected graph writes without mounting a routine save-status tooltip', async () => {
    const io = memoryIo();
    const write = io.set;
    io.set = (key, value) => key === STORAGE_KEYS.graphs ? false : write(key, value);
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    runCommand(ctx, 'editing.node.create');
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(document.querySelector('.save-state')).toBeNull();
    expect(document.querySelector('.app-notice')?.textContent).toContain('Export JSON');
  }, 15000);

  it('recovers the last valid backup when the primary payload is malformed', async () => {
    const io = memoryIo();
    const first = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    runCommand(first, 'editing.node.create');
    flushPersist();
    runCommand(first, 'editing.node.create');
    flushPersist();
    expect(io.get<any>(STORAGE_KEYS.graphsBackup, null)?.graphs[0].snapshot.nodes).toHaveLength(1);
    io.set(STORAGE_KEYS.graphs, { current: 'g1', graphs: [{ id: 'g1', snapshot: { nodes: 'broken', edges: [] } }] });

    const second = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    expect(second.graphs.current.nodes()).toHaveLength(1);
    expect(document.querySelector('.app-notice')?.textContent).toContain('Recovered graphs');
  }, 15000);

  it('lets the user restore the previous valid browser save', async () => {
    const io = memoryIo();
    const ctx = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    runCommand(ctx, 'editing.node.create');
    flushPersist();
    runCommand(ctx, 'editing.node.create');
    flushPersist();
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
    expect(io.get<any>(STORAGE_KEYS.graphsBackup, null)?.graphs[0].snapshot.nodes).toHaveLength(1);

    expect(runCommand(ctx, 'io.backup.restore.request')).toBe(true);
    await settle();
    expect(document.querySelector('.restore-preview')?.textContent).toContain('Current graphs will be replaced');
    expect(runCommand(ctx, 'io.backup.restore.confirm')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    expect(document.querySelector('.app-notice')?.textContent).toContain('Restored the previous');
  }, 15000);
});
