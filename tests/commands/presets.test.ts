import { describe, expect, it } from 'vitest';
import { memoryIo } from '../../frontend/core';
import { BUILTIN_NODE_TYPES } from '../../frontend/model';
import { bootApp, runCommand, settle } from './testkit';

/** Graph presets: a per-graph canvas mode (shell `data-preset` attr + defaults
 *  for new nodes), persisted via io under
 *  `preset:<graphId>`. `none` renders exactly like the default canvas. */

const shell = () => document.querySelector<HTMLElement>('.shell')!;

const click = (el: HTMLElement) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('graph presets', () => {
  it('stays out of the top bar while remaining available from commands', async () => {
    const ctx = bootApp();
    await settle();
    const button = document.querySelector<HTMLElement>('.tool-panel[data-panel-id="top"] [data-command="preset.open"]');
    expect(button).toBeNull();

    expect(runCommand(ctx, 'preset.open')).toBe(true);
    await settle();
    expect(document.querySelector('.modal-head')?.textContent).toContain('Choose collection');
    const choices = [...document.querySelectorAll<HTMLElement>('[data-preset-choice]')];
    expect(choices.map(el => el.dataset.presetChoice)).toEqual(
      ['none', 'basic', 'architecture', 'jira', 'flowchart', 'mindmap', 'c4', 'uml', 'outline', 'autonomous']);
    // Default graph has no preset — `none` is the pressed choice.
    expect(choices[0].getAttribute('aria-pressed')).toBe('true');
    expect(choices[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('applies and persists the preset without changing layout', async () => {
    const io = memoryIo();
    const ctx = bootApp({}, io);
    await settle();
    const changed: string[] = [];
    const fits: string[] = [];
    ctx.bus.on('preset.changed', ({ preset }) => changed.push(preset));
    ctx.bus.on('layout.fit', ({ kind }) => fits.push(kind));

    ctx.bus.emit('preset.set', { preset: 'uml' });
    await settle();

    const gid = ctx.graphs.current.id;
    expect(shell().getAttribute('data-preset')).toBe('uml');
    expect(io.get(`preset:${gid}`, null)).toBe('uml');
    expect(changed).toEqual(['uml']);
    expect(fits).toEqual([]);
  });

  it('never requests layout when collections change', async () => {
    const ctx = bootApp();
    await settle();
    const fits: string[] = [];
    ctx.bus.on('layout.fit', ({ kind }) => fits.push(kind));
    ctx.bus.emit('preset.set', { preset: 'uml' });
    ctx.bus.emit('preset.set', { preset: 'outline' });
    ctx.bus.emit('preset.set', { preset: 'architecture' });
    await settle();
    expect(fits).toEqual([]);
    expect(shell().getAttribute('data-preset')).toBe('architecture');
  });

  it('architecture preset defaults new nodes to the dense block type', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('preset.set', { preset: 'architecture' });
    await settle();
    ctx.bus.emit('graph.node.create', { Label: { text: 'Gated MLA' } });
    await settle();
    const created = ctx.graphs.current.nodes().find(node => node.Label.text === 'Gated MLA');
    expect(created?.NodeType).toBe('dense');
  });

  it('the type picker keeps the full reusable catalog across presets', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('graph.node.create', { Label: { text: 'Pick target' } });
    await settle();
    const id = ctx.graphs.current.nodes()[0]!.id;
    ctx.selection.select({ kind: 'node', id });
    await settle();

    const pickerValues = async () => {
      runCommand(ctx, 'node.type.open');
      await settle();
      const values = [...document.querySelectorAll<HTMLElement>('[data-type-choice]')]
        .map(el => el.dataset.typeChoice);
      ctx.bus.emit('modal.close');
      await settle();
      return values;
    };

    const all = BUILTIN_NODE_TYPES.map(def => def.id);
    expect(await pickerValues()).toEqual(all);

    ctx.bus.emit('preset.set', { preset: 'architecture' });
    await settle();
    expect(await pickerValues()).toEqual(all);

    ctx.bus.emit('preset.set', { preset: 'outline' });
    await settle();
    expect(await pickerValues()).toEqual(all);

    // Collection changes decoration/defaults, not catalog reachability.
    ctx.bus.emit('preset.set', { preset: 'jira' });
    await settle();
    expect(await pickerValues()).toEqual(all);
  });

  it('registers, persists, and activates a user-defined collection (UGC seam)', async () => {
    const io = memoryIo();
    const ctx = bootApp({}, io);
    await settle();

    const custom = {
      id: 'my-erd', label: 'My ERD', layout: 'horizontal', defaultNodeType: 'square',
      types: [
        { value: 'square', color: 'blue', fill: 'solid', label: 'Entity' },
        { value: 'diamond', color: 'yellow', fill: 'soft', label: 'Relation' },
      ],
    };
    ctx.bus.emit('preset.register', { preset: custom as never });
    await settle();

    // Persisted as plain JSON under the user-collections key.
    const saved = io.get('presets:user', []) as { id: string }[];
    expect(saved.map(d => d.id)).toContain('my-erd');

    // It appears in the collection picker and can be activated + defaults apply.
    runCommand(ctx, 'preset.open');
    await settle();
    const ids = [...document.querySelectorAll<HTMLElement>('[data-preset-choice]')].map(el => el.dataset.presetChoice);
    expect(ids).toContain('my-erd');
    ctx.bus.emit('modal.close');

    ctx.bus.emit('preset.set', { preset: 'my-erd' });
    await settle();
    expect(shell().getAttribute('data-preset')).toBe('my-erd');
    ctx.bus.emit('graph.node.create', { Label: { text: 'Users' } });
    await settle();
    const node = ctx.graphs.current.nodes().find(n => n.Label.text === 'Users');
    expect(node?.NodeType).toBe('square');
    expect(node?.Color).toBe('blue');
    expect(node?.Fill).toBe('solid');
  });

  it('rejects a malformed user collection', async () => {
    const io = memoryIo();
    const ctx = bootApp({}, io);
    await settle();
    // Missing types / bad shape → dropped, nothing persisted.
    ctx.bus.emit('preset.register', { preset: { id: 'bad', label: '', types: [] } as never });
    await settle();
    expect(io.get('presets:user', [])).toEqual([]);
  });

  it('isolates user collections between app IO instances', async () => {
    const first = bootApp({}, memoryIo());
    await settle();
    first.bus.emit('preset.register', {
      preset: { id: 'private', label: 'Private', defaultNodeType: 'square', types: [{ value: 'square' }] } as never,
    });
    await settle();

    const second = bootApp({}, memoryIo());
    await settle();
    runCommand(second, 'preset.open');
    await settle();
    const ids = [...document.querySelectorAll<HTMLElement>('[data-preset-choice]')]
      .map(el => el.dataset.presetChoice);
    expect(ids).not.toContain('private');
  });

  it('defaults new nodes to the preset type but keeps explicit types', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('preset.set', { preset: 'uml' });
    await settle();

    ctx.bus.emit('graph.node.create', { Label: { text: 'Kickoff' } });
    await settle();
    const created = ctx.graphs.current.nodes().find(node => node.Label.text === 'Kickoff');
    expect(created?.NodeType).toBe('uml-class');

    ctx.bus.emit('graph.node.create', { Label: { text: 'Explicit' }, NodeType: 'circle' });
    await settle();
    const circle = ctx.graphs.current.nodes().find(node => node.Label.text === 'Explicit');
    expect(circle?.NodeType).toBe('circle');
  });

  it('preset none removes the attribute and stops defaulting node types', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('preset.set', { preset: 'uml' });
    await settle();
    expect(shell().getAttribute('data-preset')).toBe('uml');

    ctx.bus.emit('preset.set', { preset: 'none' });
    await settle();
    expect(shell().hasAttribute('data-preset')).toBe(false);

    ctx.bus.emit('graph.node.create', { Label: { text: 'Plain' } });
    await settle();
    const plain = ctx.graphs.current.nodes().find(node => node.Label.text === 'Plain');
    expect(plain?.NodeType).toBe('text');
  });

  it('applies a preset chosen in the modal and closes the modal', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'preset.open');
    await settle();
    click(document.querySelector<HTMLElement>('[data-preset-choice="uml"]')!);
    await settle();
    expect(shell().getAttribute('data-preset')).toBe('uml');
    expect(document.querySelector('.modal-layer')).toBeNull();
  });

  it('keeps presets per-graph across graph switches', async () => {
    const ctx = bootApp();
    await settle();
    const firstId = ctx.graphs.current.id;
    ctx.bus.emit('preset.set', { preset: 'outline' });
    await settle();
    expect(shell().getAttribute('data-preset')).toBe('outline');

    ctx.bus.emit('graph.create');
    await settle();
    expect(ctx.graphs.current.id).not.toBe(firstId);
    expect(shell().hasAttribute('data-preset')).toBe(false);

    ctx.bus.emit('graph.node.create', { Label: { text: 'Second graph node' } });
    await settle();
    expect(ctx.graphs.current.nodes()[0]?.NodeType).toBe('text');

    ctx.bus.emit('graph.switch', { id: firstId });
    await settle();
    expect(shell().getAttribute('data-preset')).toBe('outline');
  });
});
