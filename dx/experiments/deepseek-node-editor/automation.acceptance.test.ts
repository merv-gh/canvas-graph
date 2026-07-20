import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

type AutomationSnapshot = {
  types: string[];
  nodes: Array<{
    id: string;
    type: string;
    config: Record<string, unknown>;
    status: 'idle' | 'running' | 'success' | 'error';
    input?: unknown;
    output?: unknown;
    error?: string;
  }>;
  lastRun: null | { status: 'success' | 'error'; order: string[]; output?: unknown; error?: string };
};

const apiOf = (ctx: ReturnType<typeof bootApp>) => (ctx as unknown as {
  automation?: {
    registerType(def: { type: string; label: string; execute(input: unknown, config: Record<string, unknown>): unknown }): () => void;
    configure(nodeId: string, type: string, config?: Record<string, unknown>): void;
    run(): unknown;
    reset(): void;
    snapshot(): AutomationSnapshot;
  };
}).automation;

const createExample = async () => {
  const ctx = bootApp();
  expect(runCommand(ctx, 'automation.example.create')).toBe(true);
  await settle();
  const api = apiOf(ctx);
  expect(api).toBeTruthy();
  return { ctx, api: api! };
};

describe('automation acceptance', () => {
  it('creates and executes the canonical four-node workflow in graph order', async () => {
    const { ctx, api } = await createExample();
    expect(ctx.graphs.current.nodes().map(node => node.Label.text)).toEqual([
      'Manual Trigger', 'Set Message', 'Uppercase', 'Output',
    ]);
    expect(ctx.graphs.current.edges()).toHaveLength(3);
    expect(api.snapshot().nodes.map(node => node.type)).toEqual(['manual', 'set', 'uppercase', 'output']);

    expect(runCommand(ctx, 'automation.run')).toBe(true);
    await settle();
    const run = api.snapshot();
    expect(run.nodes.every(node => node.status === 'success')).toBe(true);
    expect(run.nodes.at(-1)?.output).toBe('HELLO FROM CANVAS');
    expect(run.lastRun?.status).toBe('success');
    expect(run.lastRun?.order).toEqual(run.nodes.map(node => node.id));
    expect(document.querySelectorAll('.automation-status')).toHaveLength(4);
    expect(document.querySelectorAll('.automation-status-success')).toHaveLength(4);
  });

  it('renders inspector UI and reset keeps configuration', async () => {
    const { ctx, api } = await createExample();
    runCommand(ctx, 'automation.run');
    runCommand(ctx, 'automation.inspector.open');
    await settle();
    expect(document.querySelector('.automation-inspector')).not.toBeNull();
    expect(document.querySelectorAll('.automation-inspector .automation-node-row')).toHaveLength(4);
    expect(document.body.textContent).toContain('HELLO FROM CANVAS');

    expect(runCommand(ctx, 'automation.reset')).toBe(true);
    await settle();
    expect(api.snapshot().nodes.every(node => node.status === 'idle')).toBe(true);
    expect(api.snapshot().nodes.find(node => node.type === 'set')?.config.value).toBe('hello from canvas');
    expect(api.snapshot().lastRun).toBeNull();
  });

  it('supports custom node types and unregisters them', async () => {
    const { ctx, api } = await createExample();
    const uppercase = api.snapshot().nodes.find(node => node.type === 'uppercase')!;
    const unregister = api.registerType({
      type: 'suffix',
      label: 'Suffix',
      execute: input => `${String(input)}!`,
    });
    api.configure(uppercase.id, 'suffix');
    runCommand(ctx, 'automation.run');
    await settle();
    expect(api.snapshot().nodes.at(-1)?.output).toBe('hello from canvas!');
    expect(api.snapshot().types).toContain('suffix');
    unregister();
    expect(api.snapshot().types).not.toContain('suffix');
  });

  it('round-trips configuration through the generic graph snapshot extension', async () => {
    const { ctx, api } = await createExample();
    const document = ctx.graphs.current.snapshot();
    expect(document.extensions?.automation).toBeTruthy();
    api.reset();
    ctx.bus.emit('graph.import.snapshot', document);
    await settle();
    expect(api.snapshot().nodes.map(node => node.type)).toEqual(['manual', 'set', 'uppercase', 'output']);
    expect(api.snapshot().nodes.find(node => node.type === 'set')?.config.value).toBe('hello from canvas');
  });

  it('marks a missing type as error and blocks its downstream result', async () => {
    const { ctx, api } = await createExample();
    const uppercase = api.snapshot().nodes.find(node => node.type === 'uppercase')!;
    api.configure(uppercase.id, 'missing-plugin');
    runCommand(ctx, 'automation.run');
    await settle();
    const snapshot = api.snapshot();
    expect(snapshot.lastRun?.status).toBe('error');
    expect(snapshot.nodes.find(node => node.id === uppercase.id)?.status).toBe('error');
    expect(snapshot.nodes.at(-1)?.status).not.toBe('success');
    expect(document.querySelector('.automation-status-error')).not.toBeNull();
  });
});

