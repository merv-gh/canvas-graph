import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

// Universal search: the palette finds graph items by title (not just commands) and
// navigating to one selects + fits it. The "go to" rows are a thin source over the
// hierarchy (the canonical item list) wired to the generic select/fit events.
describe('palette universal search', () => {
  it('finds graph items by title and navigates to the chosen one', async () => {
    const ctx = bootApp();
    ctx.graphs.current.createNode({ Label: { text: 'Findme' } });
    ctx.graphs.current.createNode({ Label: { text: 'Other' } });
    await settle();

    expect(runCommand(ctx, 'palette.open')).toBe(true);
    const search = document.querySelector<HTMLInputElement>('.palette-search')!;
    search.value = 'findme';
    expect(runCommand(ctx, 'commandModal.search.change', { target: search })).toBe(true);

    const gotoRows = [...document.querySelectorAll<HTMLElement>('[data-command="palette.goto"]')];
    const labels = gotoRows.map(row => row.querySelector('b')?.textContent);
    expect(labels).toContain('Findme');           // the match is offered
    expect(labels).not.toContain('Other');         // the non-match is not

    // Activating the result selects the item and closes the palette.
    gotoRows.find(row => row.querySelector('b')?.textContent === 'Findme')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.debug!.snapshot().selection.count).toBe(1);
    expect(document.querySelector('.modal-head')).toBeNull();
  });

  it('shows no item rows for a query that matches nothing', async () => {
    const ctx = bootApp();
    ctx.graphs.current.createNode({ Label: { text: 'Alpha' } });
    await settle();
    expect(runCommand(ctx, 'palette.open')).toBe(true);
    const search = document.querySelector<HTMLInputElement>('.palette-search')!;
    search.value = 'zzznope';
    runCommand(ctx, 'commandModal.search.change', { target: search });
    expect(document.querySelectorAll('[data-command="palette.goto"]').length).toBe(0);
  });
});
