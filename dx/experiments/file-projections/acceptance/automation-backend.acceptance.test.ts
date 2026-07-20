import { describe, expect, it } from 'vitest';
import { AutomationBackend, createAutomationBackend, executeAutomation } from '../../backend/automation';

describe('automation backend acceptance', () => {
  it('is a reusable headless execution boundary with deterministic fan-in', () => {
    const backend = createAutomationBackend();
    backend.registerType({
      type: 'join',
      label: 'Join',
      execute: input => (input as unknown[]).join('|'),
    });
    const result = backend.execute({
      nodes: [
        { id: 'left', type: 'set', config: { value: 'L' } },
        { id: 'right', type: 'set', config: { value: 'R' } },
        { id: 'join', type: 'join' },
        { id: 'out', type: 'output' },
      ],
      edges: [
        { from: 'left', to: 'join' },
        { from: 'right', to: 'join' },
        { from: 'join', to: 'out' },
      ],
    });
    expect(result.lastRun).toEqual({
      status: 'success',
      order: ['left', 'right', 'join', 'out'],
      output: 'L|R',
    });
  });

  it('keeps custom registries isolated between backend instances', () => {
    const first = new AutomationBackend();
    const second = new AutomationBackend();
    first.registerType({ type: 'private', label: 'Private', execute: () => 1 });
    expect(first.types()).toContain('private');
    expect(second.types()).not.toContain('private');
  });

  it('blocks descendants of missing executors and reports cycles', () => {
    const missing = createAutomationBackend().execute({
      nodes: [
        { id: 'bad', type: 'not-installed' },
        { id: 'downstream', type: 'output' },
      ],
      edges: [{ from: 'bad', to: 'downstream' }],
    });
    expect(missing.nodes.find(node => node.id === 'bad')?.error).toContain('Unknown automation node type');
    expect(missing.nodes.find(node => node.id === 'downstream')?.error).toContain('Blocked by failed node');

    const cycle = executeAutomation({
      nodes: [{ id: 'a', type: 'manual' }, { id: 'b', type: 'output' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    });
    expect(cycle.lastRun).toMatchObject({ status: 'error', order: [], error: expect.stringContaining('cycle') });
    expect(cycle.nodes.every(node => node.status === 'error')).toBe(true);
  });
});
