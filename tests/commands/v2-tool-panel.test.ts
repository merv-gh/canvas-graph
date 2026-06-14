import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from './v2-testkit';

describe('floating tool panels', () => {
  it('renders the top toolbar as a movable collapsible stage panel', async () => {
    const ctx = bootV2();
    await settle();

    const panel = () => document.querySelector('.tool-panel[data-panel-id="top"]') as HTMLElement | null;
    const drag = () => document.querySelector('[data-tool-panel-drag="top"]') as HTMLElement | null;
    const collapse = () => document.querySelector('.tool-panel [data-fold-id="shell.top"]') as HTMLElement | null;
    const stage = ctx.contexts.places.el('stage')!;

    expect(panel()).not.toBeNull();
    expect(drag()).not.toBeNull();
    expect(collapse()).not.toBeNull();
    expect(ctx.debug!.snapshot().ui.toolPanels.top.collapsed).toBe(false);

    drag()!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 12, clientY: 12 }));
    stage.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 82, clientY: 52 }));
    stage.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    await settle();

    expect(ctx.debug!.snapshot().ui.toolPanels.top.x).toBe(82);
    expect(ctx.debug!.snapshot().ui.toolPanels.top.y).toBe(52);

    collapse()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(ctx.debug!.snapshot().ui.toolPanels.top.collapsed).toBe(true);
    expect(drag()).not.toBeNull();
    expect(collapse()).not.toBeNull();
  });

  it('collapses the top tool panel while zen is active', async () => {
    const ctx = bootV2();
    await settle();

    expect(runCommand(ctx, 'view.zen')).toBe(true);
    await settle();

    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(true);
    expect(ctx.debug!.snapshot().ui.toolPanels.top.collapsed).toBe(true);

    expect(runCommand(ctx, 'app.cancel.escape')).toBe(true);
    await settle();

    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(false);
    expect(ctx.debug!.snapshot().ui.toolPanels.top.collapsed).toBe(false);
  });
});
