import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from './testkit';

const click = (element: Element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('release UX', () => {
  it('keeps unfinished release systems and redundant toolbar actions off the surface', async () => {
    const ctx = bootApp();
    await settle();
    expect(ctx.contexts.commands.get('present.toggle')).toBeUndefined();
    expect(document.querySelector('[data-command="demo.render-self"]')).toBeNull();
    expect(document.querySelector('[data-command="choose.all"]')).toBeNull();
    expect(document.querySelector('[data-command="view.zen"]')).toBeNull();
    expect(document.querySelectorAll('[data-command="theme.toggle"]')).toHaveLength(1);
    expect(document.querySelector('[data-command="theme.toggle"]')?.classList.contains('theme-toggle')).toBe(true);
  });

  it('turns the empty canvas placeholder into the first-node action', async () => {
    const ctx = bootApp();
    await settle();
    const empty = document.querySelector('.stage .empty-action')!;
    expect(empty.getAttribute('role')).toBe('button');
    expect(empty.getAttribute('data-command')).toBe('editing.node.create');
    click(empty);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
  });

  it('shows an editable current name, newest graphs first, and filters nested graph items', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const firstId = ctx.graphs.current.id;
    runCommand(ctx, 'graph.create');
    await settle();
    const currentTitle = document.querySelector<HTMLInputElement>('[data-graph-title]')!;
    expect(currentTitle.value).toBe('Graph 2');
    currentTitle.value = 'Roadmap';
    expect(runCommand(ctx, 'graph.rename', { target: currentTitle })).toBe(true);
    await settle();
    expect(ctx.graphs.current.name).toBe('Roadmap');
    runCommand(ctx, 'editing.node.create');
    runCommand(ctx, 'editing.node.create');
    await settle();
    click(document.querySelector('[data-fold-id="outline.panel"]')!);
    await settle();

    const cards = [...document.querySelectorAll<HTMLElement>('.graph-nav-card')];
    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.graphId).toBe(firstId);
    expect(document.querySelector('.graph-nav-current')?.textContent).toContain('Nodes');
    expect(document.querySelector('.graph-nav-current')?.textContent).toContain('Connections');
    expect(document.querySelector('.graph-nav-current')?.textContent).toContain('Containers');

    const search = document.querySelector<HTMLInputElement>('[data-graph-nav-search]')!;
    search.value = 'Node 2';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    const results = [...document.querySelectorAll('.graph-nav-item-copy strong')];
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.textContent?.includes('Node 2'))).toBe(true);
  });

  it('collapses the open graph navigator on Escape', async () => {
    const ctx = bootApp();
    await settle();
    click(document.querySelector('[data-fold-id="outline.panel"]')!);
    await settle();
    expect(document.querySelector('.graph-navigator')?.getAttribute('data-outline-folded')).toBe('false');

    expect(runCommand(ctx, 'app.cancel.escape')).toBe(true);
    await settle();
    expect(document.querySelector('.graph-navigator')?.getAttribute('data-outline-folded')).toBe('true');
  });

  it('opens a share-link modal with an explicit copy action', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    expect(runCommand(ctx, 'graph.share.copy')).toBe(true);
    await settle();
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    const input = document.querySelector<HTMLInputElement>('[data-share-url]');
    expect(input?.value).toContain('?g=');
    expect(document.querySelector('[data-share-copy]')).not.toBeNull();
    expect(document.querySelector('.share-link-panel')?.textContent).toContain('Portable snapshot link');
    expect(document.querySelector('.share-size')?.textContent).toContain('embedded in the URL');
  });

  it('offers editable, vector, and bitmap export formats', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'graph.export.json');
    await settle();
    const options = [...document.querySelectorAll('.export-option')];
    expect(options.map(option => option.textContent)).toEqual([
      'Canvas Graph JSONEditable backup',
      'SVGCurrent view · vector',
      'PNGCurrent view · 2×',
    ]);
    expect(options.map(option => option.getAttribute('data-command'))).toEqual([
      'graph.export.file.json', 'graph.export.svg', 'graph.export.png',
    ]);
  });

  it('exposes accessible modal semantics, isolates the canvas, and restores focus', async () => {
    const ctx = bootApp();
    await settle();
    const opener = document.querySelector<HTMLElement>('[data-command="theme.toggle"]')!;
    opener.focus();
    ctx.bus.emit('modal.open', { title: 'Release check', body: () => document.createElement('p') });
    await settle();
    await new Promise(resolve => setTimeout(resolve, 0));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title');
    expect(document.querySelector('.stage')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close dialog');

    expect(runCommand(ctx, 'modal.close')).toBe(true);
    await settle();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.querySelector('.stage')?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('shows notices and provides a manual Mermaid import dialog without clipboard access', async () => {
    const ctx = bootApp();
    await settle();
    ctx.bus.emit('app.notice', { message: 'Saved for release.' });
    await settle();
    expect(document.querySelector('.app-notice')?.textContent).toBe('Saved for release.');

    expect(runCommand(ctx, 'graph.import.paste')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    const source = document.querySelector<HTMLTextAreaElement>('[data-import-source]')!;
    expect(source).not.toBeNull();
    expect(source.getAttribute('aria-label')).toBe('Graph JSON or Mermaid source');
    source.value = 'flowchart LR\nA[Draft] --> B[Published]';
    click(document.querySelector('[data-import-submit]')!);
    await new Promise(resolve => setTimeout(resolve, 0));
    await settle();
    expect(document.querySelector('.import-preview')?.textContent).toContain('2 nodes and 1 edge');
  });

  it('imports its own exported JSON through the primary import dialog', async () => {
    const ctx = bootApp({ autoLayout: false });
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    runCommand(ctx, 'graph.export.json');
    await settle();
    const json = document.querySelector<HTMLTextAreaElement>('.export-json textarea')!.value;
    ctx.bus.emit('modal.close');
    runCommand(ctx, 'editing.node.create');
    expect(ctx.graphs.current.nodes()).toHaveLength(2);
    runCommand(ctx, 'graph.import.paste');
    await settle();
    const source = document.querySelector<HTMLTextAreaElement>('[data-import-source]')!;
    source.value = json;
    click(document.querySelector('[data-import-submit]')!);
    await settle();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.querySelector('.import-preview')?.textContent).toContain('JSON: 1 node and 0 edges');
    click(document.querySelector('[data-import-confirm]')!);
    await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
  });

  it('duplicates the current graph as an independent named copy', async () => {
    const ctx = bootApp({ autoLayout: false });
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const sourceId = ctx.graphs.current.id;
    runCommand(ctx, 'graph.duplicate');
    await settle();
    expect(ctx.graphs.all()).toHaveLength(2);
    expect(ctx.graphs.current.id).not.toBe(sourceId);
    expect(ctx.graphs.current.name).toContain('copy');
    expect(ctx.graphs.current.nodes()).toHaveLength(1);
    runCommand(ctx, 'editing.node.create');
    expect(ctx.graphs.get(sourceId)?.nodes()).toHaveLength(1);
  });

  it('shows only enabled commands with assigned keys in grouped shortcut help', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'help.open');
    await settle();
    expect(document.querySelector('.modal-head')?.textContent).toContain('Commands and shortcuts');
    expect(document.querySelectorAll('.shortcut-edit').length).toBeGreaterThan(5);
    expect([...document.querySelectorAll<HTMLInputElement>('.shortcut-edit')].every(input => !!input.value)).toBe(true);
    expect([...document.querySelectorAll<HTMLInputElement>('.shortcut-edit')].every(input => input.getAttribute('aria-label')?.startsWith('Shortcut for '))).toBe(true);
    expect(document.querySelector('.shortcut-edit[data-shortcut-command="demo.render-self"]')).toBeNull();
    expect(document.querySelectorAll('.command-section').length).toBeGreaterThan(2);
    expect(document.querySelector('.help-phase-row')).not.toBeNull();
  });

  it('labels the inline title editor while editing', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    ctx.bus.emit('item.title.edit', { ref: { kind: 'node', id: node.id } });
    await settle();
    const editor = document.querySelector<HTMLElement>('[data-editable-title].editing')!;
    expect(editor.getAttribute('role')).toBe('textbox');
    expect(editor.getAttribute('aria-label')).toBe('Item title');
  });

  it('combines context actions and compact properties without size controls', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.node.create');
    await settle();
    const node = ctx.graphs.current.nodes()[0];
    ctx.bus.emit('item.context.open', { kind: 'node', id: node.id });
    await settle();
    expect(document.querySelector('.context-actions')).not.toBeNull();
    expect(document.querySelector('[data-size-axis]')).toBeNull();
    expect(document.querySelector('.properties [data-field="width"]')).toBeNull();
    expect(document.querySelector('.properties [data-field="height"]')).toBeNull();
    expect(document.querySelector('.properties [data-field="title"]')).toBeNull();
    const title = document.querySelector<HTMLInputElement>('[data-item-modal-title]')!;
    expect(title.value).toBe(node.Label.text);
    title.value = 'Header title';
    expect(runCommand(ctx, 'properties.title.input', { target: title })).toBe(true);
    expect(ctx.graphs.current.getNode(node.id)?.Label.text).toBe('Header title');

    ctx.bus.emit('modal.close');
    runCommand(ctx, 'editing.container.create');
    await settle();
    const container = ctx.graphs.current.itemsOfKind<{ id: string }>('container')[0];
    ctx.bus.emit('item.context.open', { kind: 'container', id: container.id });
    await settle();
    expect(document.querySelectorAll('.property-axis-choice button')).toHaveLength(2);
    expect(document.querySelectorAll('[data-section-input]').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-command="properties.sections.add"]')).not.toBeNull();
  });
});
