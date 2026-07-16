import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

describe('top tool panel', () => {
  it('renders the top toolbar as a fixed, centered, non-draggable panel', async () => {
    const ctx = bootApp();
    await settle();

    const panel = document.querySelector('.tool-panel[data-panel-id="top"]') as HTMLElement | null;
    expect(panel).not.toBeNull();
    // Centered at the top — no drag handle, no collapse chevron.
    expect(panel!.dataset.anchor).toBe('top-center');
    expect(document.querySelector('[data-tool-panel-drag="top"]')).toBeNull();
    expect(document.querySelector('.tool-panel[data-panel-id="top"] .tool-panel-collapse')).toBeNull();
    expect(ctx.debug!.snapshot().ui.toolPanels.top.collapsed).toBe(false);
  });

  it('hides chrome in zen without unmounting it, persists through a canvas click, exits on escape', async () => {
    const ctx = bootApp();
    await settle();

    expect(runCommand(ctx, 'view.zen')).toBe(true);
    await settle();

    // Zen is a visual state; the top panel stays mounted and keeps its command
    // registrations even though CSS removes it from the visible/focusable UI.
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(true);
    expect(ctx.debug!.snapshot().ui.toolPanels.top.collapsed).toBe(false);
    expect(ctx.debug!.snapshot().ui.toolPanels.top.mounted).toBe(true);

    // A canvas background click must NOT exit zen.
    expect(runCommand(ctx, 'app.cancel.background')).toBe(true);
    await settle();
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(true);

    // Escape exits.
    expect(runCommand(ctx, 'app.cancel.escape')).toBe(true);
    await settle();
    expect(ctx.debug!.snapshot().ui.shell.zen).toBe(false);
  });
});
