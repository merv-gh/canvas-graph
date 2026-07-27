import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

/** Node visuals: per-node type (incl. ML block presets) and color on the
 *  selected node — palette commands, top-bar picker modals, rendering attrs,
 *  snapshot persistence, and the two model-architecture examples. */

const createNode = async (ctx: ReturnType<typeof bootApp>, text = 'Block') => {
  ctx.bus.emit('graph.node.create', { Label: { text } });
  await settle();
  const node = ctx.graphs.current.nodes().find(candidate => candidate.Label.text === text)!;
  ctx.selection.select({ kind: 'node', id: node.id });
  await settle();
  return node;
};

describe('node type and color', () => {
  it('sets ML block type and color on the selected node via commands', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx);

    expect(runCommand(ctx, 'node.type.attention')).toBe(true);
    await settle();
    expect(ctx.graphs.current.getNode(node.id)?.NodeType).toBe('attention');

    expect(runCommand(ctx, 'node.color.blue')).toBe(true);
    await settle();
    expect(ctx.graphs.current.getNode(node.id)?.Color).toBe('blue');

    expect(runCommand(ctx, 'node.color.clear')).toBe(true);
    await settle();
    expect(ctx.graphs.current.getNode(node.id)?.Color).toBeUndefined();
  });

  it('does not run type/color commands without a selected node', async () => {
    const ctx = bootApp();
    await settle();
    const notices: string[] = [];
    ctx.bus.on('app.notice', ({ message }) => notices.push(message));
    expect(runCommand(ctx, 'node.type.moe')).toBe(false);
    expect(runCommand(ctx, 'node.color.red')).toBe(false);
    // The open commands stay runnable (their toolbar buttons are always
    // rendered) but warn instead of opening an empty picker.
    expect(runCommand(ctx, 'node.type.open')).toBe(true);
    await settle();
    expect(notices).toContain('Select a node first');
    expect(document.querySelector('.modal-layer')).toBeNull();
  });

  it('round-trips type and color through the graph snapshot', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx);
    runCommand(ctx, 'node.type.moe');
    runCommand(ctx, 'node.color.orange');
    await settle();

    const snapshot = ctx.graphs.current.snapshot();
    const draft = snapshot.nodes.find(candidate => candidate.id === node.id)!;
    expect(draft.NodeType).toBe('moe');
    expect(draft.Color).toBe('orange');

    ctx.bus.emit('graph.import.snapshot', snapshot);
    await settle();
    const restored = ctx.graphs.current.getNode(node.id);
    expect(restored?.NodeType).toBe('moe');
    expect(restored?.Color).toBe('orange');
  });

  it('renders and round-trips fill, border color, and geometry shapes', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx, 'Decision');
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: node.id },
      patch: { NodeType: 'diamond', Fill: 'solid', BorderColor: 'none', Color: 'blue' } });
    await settle();

    const el = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)!;
    expect(el.classList.contains('node-type-diamond')).toBe(true);
    expect(el.dataset.fill).toBe('solid');
    expect(el.dataset.borderColor).toBe('none');

    const snapshot = ctx.graphs.current.snapshot();
    const draft = snapshot.nodes.find(n => n.id === node.id)!;
    expect(draft.Fill).toBe('solid');
    expect(draft.BorderColor).toBe('none');
    ctx.graphs.current.replace(snapshot);
    const restored = ctx.graphs.current.getNode(node.id);
    expect(restored?.Fill).toBe('solid');
    expect(restored?.BorderColor).toBe('none');
    expect(restored?.NodeType).toBe('diamond');
  });

  it('renders the type class and the color attribute on the node element', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx);
    runCommand(ctx, 'node.type.attention');
    runCommand(ctx, 'node.color.green');
    await settle();

    const el = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`);
    expect(el?.classList.contains('node-type-attention')).toBe(true);
    expect(el?.dataset.nodeColor).toBe('green');

    runCommand(ctx, 'node.color.clear');
    await settle();
    const cleared = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`);
    expect(cleared?.dataset.nodeColor).toBeUndefined();
  });

  it('keeps the removed style toolbar absent and exposes type in selection properties', async () => {
    const ctx = bootApp();
    await settle();
    expect(document.querySelector('.tool-panel[data-panel-id="node-style"]')).toBeNull();
    await createNode(ctx);
    expect(document.querySelector('.tool-panel[data-panel-id="node-style"]')).toBeNull();
    expect(document.querySelector('.tool-panel[data-panel-id="properties"] [data-command="node.type.open"]')).not.toBeNull();
    expect(document.querySelector('[data-command="node.color.open"]')).toBeNull();
  });

  it('removes the panel and its buttons when the system is disabled', async () => {
    const ctx = bootApp({ 'node.visuals': false });
    await settle();
    await createNode(ctx);
    expect(document.querySelector('.tool-panel[data-panel-id="node-style"]')).toBeNull();
    expect(document.querySelector('[data-command="node.type.open"]')).toBeNull();
    expect(document.querySelector('[data-command="node.color.open"]')).toBeNull();
  });
});

describe('model architecture examples', () => {
  it('loads the Kimi K2 example with typed, colored ML blocks', async () => {
    const ctx = bootApp();
    await settle();
    expect(runCommand(ctx, 'demo.render-kimi-k2')).toBe(true);
    await settle();

    const types = new Set(ctx.graphs.current.nodes().map(node => node.NodeType));
    expect(types).toContain('input');
    expect(types).toContain('embedding');
    expect(types).toContain('attention');
    expect(types).toContain('moe');
    expect(types).toContain('norm');
    expect(types).toContain('output');
    expect(ctx.graphs.current.nodes().some(node => !!node.Color)).toBe(true);
    expect(ctx.graphs.current.edges().length).toBeGreaterThan(5);
  });

  it('loads the Transformer example with typed ML blocks', async () => {
    const ctx = bootApp();
    await settle();
    expect(runCommand(ctx, 'demo.render-transformer')).toBe(true);
    await settle();

    const types = new Set(ctx.graphs.current.nodes().map(node => node.NodeType));
    expect(types).toContain('input');
    expect(types).toContain('embedding');
    expect(types).toContain('attention');
    expect(types).toContain('dense');
    expect(types).toContain('norm');
    expect(types).toContain('output');
  });

  it('operator nodes snap to the small glyph circle and ignore autosize', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx, '⊕');

    expect(runCommand(ctx, 'node.type.operator')).toBe(true);
    await settle();
    const operator = ctx.graphs.current.getNode(node.id)!;
    expect(operator.NodeType).toBe('operator');
    expect(operator.Size).toEqual({ w: 44, h: 44 });

    // A title edit must not text-fit the fixed operator circle.
    ctx.bus.emit('item.update', { ref: { kind: 'node', id: node.id }, patch: { Label: { text: 'α' } } });
    await settle();
    expect(ctx.graphs.current.getNode(node.id)!.Size).toEqual({ w: 44, h: 44 });

    // Retyping away restores the target shape's default size.
    expect(runCommand(ctx, 'node.type.text')).toBe(true);
    await settle();
    expect(ctx.graphs.current.getNode(node.id)!.NodeType).toBe('text');
    expect(ctx.graphs.current.getNode(node.id)!.Size.w).not.toBe(44);
  });

  it('caption nodes render borderless and keep their type through the snapshot', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx, 'Kimi K3 architecture: modules and backbone');
    expect(runCommand(ctx, 'node.type.caption')).toBe(true);
    await settle();
    expect(document.querySelector(`.node[data-item-id="${node.id}"].node-type-caption`)).not.toBeNull();

    const snapshot = ctx.graphs.current.snapshot();
    ctx.graphs.current.replace(snapshot);
    expect(ctx.graphs.current.getNode(node.id)?.NodeType).toBe('caption');
  });

  it('description placement renders as a data attribute and round-trips', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx, 'Gated MLA');
    ctx.bus.emit('item.update', {
      ref: { kind: 'node', id: node.id },
      patch: { Description: 'multi-head latent attention', DescriptionPlacement: 'below' },
    });
    await settle();
    const el = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)!;
    expect(el.dataset.descPlacement).toBe('below');

    const snapshot = ctx.graphs.current.snapshot();
    expect(snapshot.nodes.find(n => n.id === node.id)?.DescriptionPlacement).toBe('below');
    ctx.graphs.current.replace(snapshot);
    expect(ctx.graphs.current.getNode(node.id)?.DescriptionPlacement).toBe('below');
  });

  it('persists toggle state and changes it only through the switch command', async () => {
    const ctx = bootApp();
    await settle();
    const node = await createNode(ctx, 'Live updates');
    expect(runCommand(ctx, 'node.type.toggle')).toBe(true);
    await settle();

    const card = document.querySelector<HTMLElement>(`.node[data-item-id="${node.id}"]`)!;
    const control = card.querySelector<HTMLElement>('.node-switch-control')!;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.getNode(node.id)?.ToggleState).toBeUndefined();

    control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(ctx.graphs.current.getNode(node.id)?.ToggleState).toBe(true);
    expect(document.querySelector('.node-switch-control')?.getAttribute('aria-checked')).toBe('true');

    const snapshot = ctx.graphs.current.snapshot();
    expect(snapshot.nodes.find(candidate => candidate.id === node.id)?.ToggleState).toBe(true);
    ctx.graphs.current.replace(snapshot);
    expect(ctx.graphs.current.getNode(node.id)?.ToggleState).toBe(true);
  });
});
