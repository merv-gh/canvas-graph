import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';
import { defaultEventFilter, snapshot, snapshotTree, flattenSnapshotTree, traceToTest } from '../../v2/core';

describe('v2 debug system', () => {
  it('toggles enabled state and exposes ctx.debug', async () => {
    const ctx = bootV2();
    await settle();
    expect(ctx.debug).toBeDefined();
    expect(ctx.debug!.enabled()).toBe(false);
    runCommand(ctx, 'debug.enable');
    await settle();
    expect(ctx.debug!.enabled()).toBe(true);
  });

  it('record → events → stop captures only what the user did', async () => {
    const ctx = bootV2();
    await settle();
    ctx.debug!.setEnabled(true);
    await settle();
    ctx.debug!.start();
    expect(ctx.debug!.recording()).toBe(true);

    runCommand(ctx, 'editing.node.create');
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();

    ctx.debug!.stop();
    expect(ctx.debug!.recording()).toBe(false);

    const trace = ctx.debug!.trace();
    expect(trace.length).toBeGreaterThan(0);
    // After filtering, the meaningful events are the top-level user intents.
    const meaningful = trace.filter(defaultEventFilter);
    expect(meaningful.some(e => e.name === 'editing.node.create')).toBe(true);
    // The downstream storage CRUD is dropped — replaying editing.* re-fires it.
    expect(meaningful.every(e => e.name !== 'graph.node.create')).toBe(true);
    // Render and fact events get filtered out.
    expect(meaningful.every(e => !String(e.name).startsWith('render.'))).toBe(true);
    expect(meaningful.every(e => !/\.created$/.test(String(e.name)))).toBe(true);
  });

  it('clear empties the trace without affecting recording state', async () => {
    const ctx = bootV2();
    await settle();
    ctx.debug!.setEnabled(true);
    ctx.debug!.start();
    runCommand(ctx, 'editing.node.create');
    await settle();
    ctx.debug!.stop();
    expect(ctx.debug!.trace().length).toBeGreaterThan(0);

    ctx.debug!.clear();
    expect(ctx.debug!.trace()).toEqual([]);
    expect(ctx.debug!.recording()).toBe(false);
  });

  it('snapshot exposes graph / selection / view / flags / dx', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const snap = snapshot(ctx);
    expect(snap.graph.nodes).toHaveLength(1);
    expect(snap.selection.selected?.kind).toBe('node');
    expect(snap.view.scale).toBeGreaterThan(0);
    expect(snap.flags.system.length).toBeGreaterThan(0);
    expect(snap.dx.errors).toBe(0);
  });

  it('snapshot tree carries clickable code paths', async () => {
    const ctx = bootV2();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const tree = snapshotTree(snapshot(ctx));
    const flat = flattenSnapshotTree(tree);
    // Verify a few well-known paths render with idiomatic TS expressions.
    expect(flat.some(n => n.code === 'ctx.graphs.current.nodes()')).toBe(true);
    expect(flat.some(n => n.code === 'ctx.selection.selected()')).toBe(true);
    expect(flat.some(n => n.code === 'ctx.contexts.view.get()')).toBe(true);
    // A leaf inside graph.nodes[0] should be optional-chained because nodes is an array.
    expect(flat.some(n => /ctx\.graphs\.current\.nodes\(\)\[0\]\?\.Label/.test(n.code))).toBe(true);
  });

  it('traceToTest produces a runnable file with replay + assertions', async () => {
    const ctx = bootV2();
    await settle();
    ctx.debug!.setEnabled(true);
    ctx.debug!.start();
    runCommand(ctx, 'editing.node.create');
    await settle();
    ctx.debug!.stop();

    const out = ctx.debug!.generate(
      [{ code: 'ctx.graphs.current.nodes()', matcher: 'toHaveLength', expected: '1' }],
      'creates one node',
    );
    expect(out).toContain("import { describe, expect, it } from 'vitest';");
    expect(out).toContain("describe('creates one node'");
    expect(out).toContain('ctx.sim.replay(trace)');
    expect(out).toContain('expect(ctx.graphs.current.nodes()).toHaveLength(1);');
    // Render events should not appear in the embedded trace.
    expect(out).not.toContain("'render.stage.draw'");
  });

  it('paste-and-replay reconstructs state from a trace', async () => {
    const author = bootV2();
    await settle();
    author.debug!.setEnabled(true);
    author.debug!.start();
    runCommand(author, 'editing.node.create');
    await settle();
    runCommand(author, 'editing.node.create');
    await settle();
    author.debug!.stop();
    const trace = author.debug!.trace().filter(defaultEventFilter);

    // Fresh boot, replay the captured trace.
    const replayCtx = bootV2();
    await settle();
    replayCtx.sim.replay(trace);
    await settle();
    expect(replayCtx.graphs.current.nodes()).toHaveLength(2);
  });

  it('record/stop/clear commands gate on enabled flag', async () => {
    const ctx = bootV2();
    await settle();
    // Disabled: record start should be unavailable, so commands.run returns false.
    expect(ctx.contexts.commands.run('debug.record.start')).toBe(false);
    ctx.debug!.setEnabled(true);
    expect(ctx.contexts.commands.run('debug.record.start')).toBe(true);
    expect(ctx.debug!.recording()).toBe(true);
    // Starting again while recording is unavailable.
    expect(ctx.contexts.commands.run('debug.record.start')).toBe(false);
    expect(ctx.contexts.commands.run('debug.record.stop')).toBe(true);
    expect(ctx.debug!.recording()).toBe(false);
  });

  it('default filter keeps user-intent events and drops facts', () => {
    const keep = ['editing.node.create', 'editing.edge.create', 'commandForm.submit', 'modal.open', 'graph.create', 'view.fit.all', 'layout.apply.tidy', 'selection.item.select'];
    const drop = ['render.stage.draw', 'render.view.set', 'graph.node.create', 'graph.node.created', 'affordance.contributed', 'fold.changed', 'outline.draw', 'commandModal.search.changed', 'app.start', 'decoration.changed', 'item.update', 'selection.node.select', 'focus.item.focus'];
    keep.forEach(name => {
      expect(defaultEventFilter({ name: name as never, data: undefined, at: 0 }), name).toBe(true);
    });
    drop.forEach(name => {
      expect(defaultEventFilter({ name: name as never, data: undefined, at: 0 }), name).toBe(false);
    });
  });
});
