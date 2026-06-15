import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';

// The seam under test: systems declare a stage panel as data and route buttons
// to it by id, instead of hand-building a `.tool-panel` section. This is what
// unblocks the per-panel cards (zoom/debug/log/left) as views-edit + one file.
// A synthetic command id (`probe.noop`) keeps the routing assertions independent
// of which real commands already contribute a top-bar button.
describe('tool panel registry', () => {
  const panel = (id: string) =>
    document.querySelector(`.tool-panel[data-panel-id="${id}"]`) as HTMLElement | null;
  const button = (id: string, command: string) =>
    panel(id)?.querySelector(`[data-command="${command}"]`) as HTMLElement | null;

  it('renders a declared panel and routes a `panel`-tagged button into it, not the top bar', async () => {
    const ctx = bootApp();
    await settle();

    ctx.contexts.affordances.declarePanel({
      id: 'probe', anchor: 'bottom-right', movable: true, foldId: 'probe.panel', layout: 'stack', order: 5, origin: 'probe',
    });
    ctx.contexts.affordances.contribute({
      surface: 'top', panel: 'probe', command: 'probe.noop', kind: 'button', text: 'Probe', origin: 'probe',
    });
    await settle();

    // The panel mounts with its drag + collapse chrome, anchored bottom-right.
    expect(panel('probe')).not.toBeNull();
    expect(panel('probe')!.dataset.anchor).toBe('bottom-right');
    expect(panel('probe')!.querySelector('[data-tool-panel-drag="probe"]')).not.toBeNull();
    expect(panel('probe')!.querySelector('[data-fold-id="probe.panel"]')).not.toBeNull();

    // The button lands in `probe`, and NOT in the default top toolbar (routing).
    expect(button('probe', 'probe.noop')).not.toBeNull();
    expect(button('top', 'probe.noop')).toBeNull();
  });

  it('honours mountWhen — unmounts when false, remounts when true', async () => {
    const ctx = bootApp();
    await settle();

    let visible = false;
    ctx.contexts.affordances.declarePanel({
      id: 'gated', anchor: 'top-right', mountWhen: () => visible, origin: 'probe',
    });
    ctx.contexts.affordances.contribute({
      surface: 'top', panel: 'gated', command: 'probe.noop', kind: 'button', text: 'Probe', origin: 'probe',
    });
    await settle();
    expect(panel('gated')).toBeNull();

    // Any top-surface redraw re-evaluates mountWhen; emit the fact directly so
    // the test starts no async work (camera animations) that would outlive it.
    visible = true;
    ctx.bus.emit('affordance.contributed', { surface: 'top' });
    await settle();
    expect(panel('gated')).not.toBeNull();
  });

  it('tears the panel and its buttons down with the declaring origin', async () => {
    const ctx = bootApp();
    await settle();

    ctx.contexts.affordances.declarePanel({ id: 'probe', anchor: 'bottom-left', origin: 'probe' });
    ctx.contexts.affordances.contribute({
      surface: 'top', panel: 'probe', command: 'probe.noop', kind: 'button', text: 'Probe', origin: 'probe',
    });
    await settle();
    expect(panel('probe')).not.toBeNull();

    ctx.contexts.affordances.unregisterOrigin('probe');
    await settle();
    expect(panel('probe')).toBeNull();
    expect(ctx.contexts.affordances.panels().some(p => p.id === 'probe')).toBe(false);
  });
});
