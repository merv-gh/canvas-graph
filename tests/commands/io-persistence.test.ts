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
    expect(first.graphs.all()).toHaveLength(2);
    flushPersist();

    const second = bootApp({ dx: false, demo: false, debug: false, autoLayout: false }, io);
    await settle();
    expect(second.graphs.all()).toHaveLength(2);
    expect(second.graphs.current.id).toBe(activeId);
    expect(second.graphs.current.nodes()).toHaveLength(2);
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
});
