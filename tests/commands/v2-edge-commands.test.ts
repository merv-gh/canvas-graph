import { describe, expect, it } from 'vitest';
import { bootV2, commandButton, field, modalText, runCommand, settle } from './v2-testkit';

const createNode = async (ctx: ReturnType<typeof bootV2>) => {
  runCommand(ctx, 'editing.node.create');
  await settle();
  return ctx.graphs.current.nodes().at(-1)!;
};

describe('v2 edge commands', () => {
  it('opens an explanatory form when edge creation has too few nodes', () => {
    const ctx = bootV2();

    expect(runCommand(ctx, 'graph.edge.create')).toBe(true);

    expect(modalText()).toContain('Create edge');
    expect(document.querySelector('.form-error')?.textContent).toBe('Create at least two nodes before creating an edge.');
    expect(document.querySelector('.log-row')?.textContent).toContain('Create at least two nodes before creating an edge.');
  });

  it('prefills source and target, then submits through commandForm', async () => {
    const ctx = bootV2();
    const source = await createNode(ctx);
    const target = await createNode(ctx);

    ctx.bus.emit('selection.node.select', { id: source.id });
    expect(runCommand(ctx, 'graph.edge.create')).toBe(true);
    expect(field('From')?.value).toBe(source.id);
    expect(field('To')?.value).toBe(target.id);

    expect(runCommand(ctx, 'commandForm.submit', { target: commandButton('commandForm.submit') })).toBe(true);

    expect(ctx.graphs.current.edges().map(edge => ({ From: edge.From, To: edge.To })))
      .toEqual([{ From: source.id, To: target.id }]);
    expect(document.querySelector('.modal-layer')).toBeNull();
  });

  it('validates source and target before storing an edge', async () => {
    const ctx = bootV2();
    const source = await createNode(ctx);
    await createNode(ctx);

    runCommand(ctx, 'graph.edge.create');
    field('From')!.value = source.id;
    field('To')!.value = source.id;
    expect(runCommand(ctx, 'commandForm.submit', { target: commandButton('commandForm.submit') })).toBe(true);

    expect(ctx.graphs.current.edges()).toHaveLength(0);
    expect(document.querySelector('.form-error')?.textContent).toBe('Source and target must be different nodes.');

    ctx.bus.emit('graph.edge.create', { From: source.id, To: 'missing' });
    ctx.bus.emit('graph.edge.create', { From: source.id, To: source.id });
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });

  it('shows specific edge form validation messages for missing and unknown endpoints', async () => {
    const ctx = bootV2();
    await createNode(ctx);
    await createNode(ctx);

    runCommand(ctx, 'graph.edge.create');
    field('From')!.value = '';
    field('To')!.value = '';
    runCommand(ctx, 'commandForm.submit', { target: commandButton('commandForm.submit') });
    expect(document.querySelector('.form-error')?.textContent).toBe('Choose source and target nodes.');

    field('From')!.value = 'missing-source';
    field('To')!.value = ctx.graphs.current.nodes()[0].id;
    runCommand(ctx, 'commandForm.submit', { target: commandButton('commandForm.submit') });
    expect(document.querySelector('.form-error')?.textContent).toBe('Unknown source node "missing-source".');

    field('From')!.value = ctx.graphs.current.nodes()[0].id;
    field('To')!.value = 'missing-target';
    runCommand(ctx, 'commandForm.submit', { target: commandButton('commandForm.submit') });
    expect(document.querySelector('.form-error')?.textContent).toBe('Unknown target node "missing-target".');
  });

  it('keeps the form open when form payload cannot be built', () => {
    const ctx = bootV2();
    ctx.contexts.commands.register([{
      id: 'test.null-form',
      label: 'Null form command',
      event: 'app.notice',
      group: 'test',
      form: {
        fields: [],
        shouldOpen: () => true,
        payload: () => undefined,
      },
    }]);

    expect(runCommand(ctx, 'test.null-form')).toBe(true);
    expect(runCommand(ctx, 'commandForm.submit', { target: commandButton('commandForm.submit') })).toBe(true);
    expect(document.querySelector('.form-error')?.textContent).toBe('Fill the required fields.');
    expect(document.querySelector('.modal-layer')).not.toBeNull();
  });

  it('updates, opens properties for, and deletes an edge', async () => {
    const ctx = bootV2();
    const source = await createNode(ctx);
    const target = await createNode(ctx);
    ctx.bus.emit('graph.edge.create', { From: source.id, To: target.id });
    const edge = ctx.graphs.current.edges()[0];

    ctx.bus.emit('graph.edge.update', { id: edge.id, patch: { Label: { text: 'depends' } } });
    expect(edge.Label?.text).toBe('depends');

    const fakeRow = document.createElement('button');
    fakeRow.dataset.itemKind = 'edge';
    fakeRow.dataset.itemId = edge.id;
    expect(runCommand(ctx, 'item.properties.open', { target: fakeRow })).toBe(true);
    expect(modalText()).toContain('Edge Properties');
    const label = document.querySelector<HTMLInputElement>('.properties [data-field="label"]')!;
    label.value = 'blocks';
    expect(runCommand(ctx, 'properties.item.input', { target: label })).toBe(true);
    expect(edge.Label?.text).toBe('blocks');

    expect(runCommand(ctx, 'graph.edge.delete', { target: fakeRow })).toBe(true);
    expect(ctx.graphs.current.edges()).toHaveLength(0);
  });
});
