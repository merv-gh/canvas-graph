import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from '../testkit';

describe("Zoom and fit buttons should live in a bottom-right tool panel", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootApp();
    await settle();

    expect(document.querySelectorAll(".tool-panel[data-panel-id=\"zoom\"] [data-command=\"view.zoom.in\"]").length).toBe(1);
    expect(document.querySelectorAll(".tool-panel[data-panel-id=\"top\"] [data-command=\"view.zoom.in\"]").length).toBe(0);
  });
});
