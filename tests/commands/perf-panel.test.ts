import { describe, expect, it, vi } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

describe('perf panel', () => {
  it('renders sortable rows, exports short text, and resets recorder', async () => {
    const ctx = bootApp({ perf: true });
    const event = new Event('pointermove');
    const target = document.createElement('button');
    target.className = 'node-drag-handle';
    document.body.append(target);

    ctx.perf.measure('Outer.work', () => ctx.perf.measure('Inner.work', () => undefined));
    ctx.perf.beginInput('pointermove', event, target)?.end({
      candidates: ['drag.item.move', 'view.pan.move'],
      matched: ['drag.item.move'],
    });
    ctx.perf.recordInput({
      source: 'event-timing',
      name: 'pointerup',
      target: 'span.node-drag-handle',
      startTime: 10,
      processingStart: 18,
      processingEnd: 19,
      duration: 24,
      inputDelay: 8,
      processingDuration: 1,
      presentationDelay: 15,
      path: ['span.node-drag-handle', 'main.stage'],
    });
    ctx.perf.recordLongTask({ name: 'self', start: 20, duration: 51 });

    expect(runCommand(ctx, 'perf.show')).toBe(true);
    await settle();
    expect(document.querySelector('.perf-panel')?.textContent).toContain('Input Paths');
    expect(document.querySelector('.perf-panel')?.textContent).toContain('Copy Short');
    expect(document.querySelector('.perf-export')).not.toBeNull();

    const delayHeader = [...document.querySelectorAll<HTMLElement>('.perf-table th')]
      .find(th => th.textContent === 'Delay')!;
    delayHeader.click();
    expect(delayHeader.classList.contains('is-sorted')).toBe(true);
    delayHeader.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(runCommand(ctx, 'perf.copy')).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('summary inputDelay='));
    expect(clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('drag.item.move'));
    info.mockRestore();

    expect(runCommand(ctx, 'perf.reset')).toBe(true);
    expect(ctx.perf.snapshot().inputs).toHaveLength(0);
    target.remove();
  });
});
