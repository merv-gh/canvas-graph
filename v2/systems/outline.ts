import {
  commandShortcut,
  emptyState,
  type AppCollectionDef,
  type Registry,
} from '../core';
import { Places } from '../types';

export function registerOutline(system: Registry) {
  system('outline', ctx => {
    const { on, emit, contexts, model } = ctx;
    const searches = new Map<string, string>();
    const el = (tag: string, className?: string, text?: string) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const renderCollection = (collectionDef: AppCollectionDef<unknown>) => {
      const section = el('section', 'outline-section');
      const head = el('div', 'outline-head');
      const title = el('h2', 'panel-title', collectionDef.label);
      const createButton = el('button', 'icon-button', '+') as HTMLButtonElement;
      createButton.dataset.command = collectionDef.crud.create;
      head.append(title, createButton);
      section.append(head);

      const query = searches.get(collectionDef.id) ?? '';
      const search = el('input', 'outline-search') as HTMLInputElement;
      search.placeholder = `Search ${collectionDef.label.toLowerCase()}`;
      search.value = query;
      search.dataset.collectionId = collectionDef.id;
      section.append(search);

      const list = el('div', 'outline-list');
      const filtered = collectionDef.items(ctx)
        .filter(item => collectionDef.itemLabel(item).toLowerCase().includes(query.toLowerCase()));
      filtered.forEach(item => {
        const id = collectionDef.itemId(item);
        const row = el('div', 'outline-row');
        row.dataset.itemId = id;
        const kind = collectionDef.entity?.kind;
        if (kind) row.dataset.itemKind = kind;
        if (collectionDef.id === 'graphs') row.dataset.graphId = id;
        if (collectionDef.id === 'nodes') row.dataset.nodeId = id;
        if (kind === 'edge') row.dataset.edgeId = id;
        const main = el('button', 'outline-main', collectionDef.itemLabel(item)) as HTMLButtonElement;
        if (collectionDef.selectCommand) main.dataset.command = collectionDef.selectCommand;
        const properties = collectionDef.entity?.properties?.length
          ? el('button', 'icon-button', '⚙') as HTMLButtonElement
          : null;
        if (properties) properties.dataset.command = 'item.properties.open';
        const remove = el('button', 'icon-button', 'x') as HTMLButtonElement;
        remove.dataset.command = collectionDef.crud.delete;
        row.append(...[main, properties, remove].filter(Boolean) as HTMLElement[]);
        list.append(row);
      });
      section.append(list);
      if (!filtered.length) {
        const shortcut = commandShortcut(contexts.commands, collectionDef.crud.create);
        const title = query ? `No matches for "${query}"` : `No ${collectionDef.label.toLowerCase()} yet`;
        const hint = !query && shortcut ? `Press <kbd>${shortcut}</kbd> or click +` : '';
        const empty = emptyState(contexts, title, hint);
        if (empty) section.append(empty);
      }
      return section;
    };
    const renderOutline = () => {
      const panel = el('section', 'outline');
      model.collections().forEach(collectionDef => panel.append(renderCollection(collectionDef as AppCollectionDef<unknown>)));
      return panel;
    };
    const draw = () => emit('render.view.set', { place: Places.Left, key: 'outline', view: renderOutline });
    contexts.commands.register([{
      id: 'outline.search.change',
      label: 'Change outline search',
      event: 'outline.search.changed',
      group: 'outline',
      hidden: true,
      input: { on: 'input', selector: '.outline-search' },
      payload: ({ target }) => ({
        collectionId: (target as HTMLElement).dataset.collectionId!,
        query: (target as HTMLInputElement).value,
      }),
    }]);
    on('app.start', draw);
    on('outline.draw', draw);
    on('outline.search.changed', ({ collectionId, query }) => {
      searches.set(collectionId, query);
      draw();
      queueMicrotask(() => {
        const next = contexts.places.el(Places.Left)?.querySelector(`[data-collection-id="${collectionId}"]`) as HTMLInputElement | null;
        next?.focus();
        next?.setSelectionRange(next.value.length, next.value.length);
      });
    });
  });
}
