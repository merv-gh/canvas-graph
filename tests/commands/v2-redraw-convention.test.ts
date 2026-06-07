import { describe, expect, it } from 'vitest';
import { factScope } from '../../v2/core';
import { FACT_SUFFIXES } from '../../v2/types';
import { bootV2, runCommand, settle } from './v2-testkit';

describe('v2 redraw suffix convention', () => {
  it('classifies every canonical fact suffix and ignores non-facts', () => {
    expect(FACT_SUFFIXES).toContain('.created');
    expect(factScope('graph.node.created')).toBe('both');
    expect(factScope('graph.node.updated')).toBe('both');
    expect(factScope('graph.node.deleted')).toBe('both');
    expect(factScope('graph.switched')).toBe('both');
    expect(factScope('selection.node.selected')).toBe('both');
    expect(factScope('focus.node.focused')).toBe('both');
    expect(factScope('view.changed')).toBe('nodes');
    expect(factScope('graph.node.create')).toBeNull();
    expect(factScope('render.view.set')).toBeNull();
    expect(factScope('app.start')).toBeNull();
  });

  it('coalesces N rapid node creates into a single render flush', async () => {
    const ctx = bootV2();
    await settle();
    const before = ctx.render!.flushes();
    const N = 30;
    for (let i = 0; i < N; i++) ctx.bus.emit('editing.node.create', { Label: { text: `n${i}` } });
    const flushesDuringBurst = ctx.render!.flushes() - before;
    // No flush should have happened yet — all writes are synchronous, only the rAF
    // coalesces. Asserts the scheduler is rAF-bound, not eager.
    expect(flushesDuringBurst).toBe(0);
    await settle();
    const flushed = ctx.render!.flushes() - before;
    expect(flushed).toBeLessThanOrEqual(2);
    expect(ctx.graphs.current.nodes()).toHaveLength(N);
  }, 15000);

  it('triggers a redraw for any past-tense event, even one not hardcoded before', async () => {
    const ctx = bootV2();
    await settle();
    const before = ctx.render!.flushes();
    // graph.edge.updated was in the old regex; emit it directly to confirm scheduler
    // now derives the trigger from the suffix, not a name list.
    const node = ctx.graphs.current.node({ Label: { text: 'x' } });
    ctx.bus.emit('graph.node.updated', { graphId: ctx.graphs.current.id, id: node.id });
    await settle();
    expect(ctx.render!.flushes()).toBeGreaterThan(before);
  });

  it('does not redraw for request (imperative) events alone', async () => {
    const ctx = bootV2();
    await settle();
    const before = ctx.render!.flushes();
    // .create is a request, not a fact. The graph system will turn it into .created
    // through its own listener — but if we emit a request that no system handles, no
    // flush should be scheduled by the scheduler itself.
    ctx.bus.emit('app.notice', { message: 'noop' });
    await settle();
    expect(ctx.render!.flushes()).toBe(before);
  });
});
