import {
  collectionCreateCommand,
  collectionDeleteCommand,
  collectionSelectCommand,
  commandShortcut,
  emptyState,
  kbdHint,
  type AppCollectionDef,
  type Registry,
} from '../core';
import { Places } from '../types';
import type { Id } from '../types';

declare module '../types' {
  interface CustomEvents {
    'outline.draw': void;
    'outline.search.changed': { collectionId: Id; query: string };
  }
}

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
    const foldIdFor = (collectionId: string) => `outline.collection.${collectionId}`;
    const renderCollection = (collectionDef: AppCollectionDef<unknown>) => {
      const section = el('section', 'outline-section');
      const foldId = foldIdFor(collectionDef.id);
      const open = contexts.fold.isOpen(foldId, true);
      section.classList.toggle('folded', !open);
      section.dataset.collectionId = collectionDef.id;
      const head = el('div', 'outline-head');
      // The fold trigger lives on a wrapper around the title — clicking the
      // chevron OR the section name toggles. The search input itself stays
      // independent (input listener stops propagation).
      const foldTrigger = el('button', 'icon-button outline-fold', open ? '▾' : '▸') as HTMLButtonElement;
      foldTrigger.dataset.foldId = foldId;
      foldTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      foldTrigger.setAttribute('aria-label', open ? `Collapse ${collectionDef.label}` : `Expand ${collectionDef.label}`);

      const query = searches.get(collectionDef.id) ?? '';
      const title = el('input', 'panel-title outline-title-search') as HTMLInputElement;
      const createCommand = collectionCreateCommand(collectionDef);
      const deleteCommand = collectionDeleteCommand(collectionDef);
      const selectCommand = collectionSelectCommand(collectionDef);
      title.placeholder = collectionDef.label;
      title.value = query;
      title.dataset.collectionId = collectionDef.id;
      title.setAttribute('aria-label', `Search ${collectionDef.label.toLowerCase()}`);
      const createButton = el('button', 'icon-button', '+') as HTMLButtonElement;
      createButton.dataset.command = createCommand;
      head.append(foldTrigger, title, createButton);
      section.append(head);

      // Folded sections render only the header. The list + empty state are
      // skipped entirely so a folded collection costs zero DOM per row.
      if (!open) return section;

      const list = el('div', 'outline-list');
      const filtered = collectionDef.items(ctx)
        .filter(item => collectionDef.itemLabel(item).toLowerCase().includes(query.toLowerCase()));
      filtered.forEach(item => {
        const id = collectionDef.itemId(item);
        const row = el('div', 'outline-row');
        row.dataset.itemId = id;
        row.dataset.itemKind = collectionDef.kind;
        const main = el('button', 'outline-main', collectionDef.itemLabel(item)) as HTMLButtonElement;
        main.dataset.command = selectCommand;
        const properties = collectionDef.entity?.properties?.length
          ? el('button', 'icon-button', '⚙') as HTMLButtonElement
          : null;
        if (properties) properties.dataset.command = 'item.properties.open';
        const remove = el('button', 'icon-button', 'x') as HTMLButtonElement;
        remove.dataset.command = deleteCommand;
        row.append(...[main, properties, remove].filter(Boolean) as HTMLElement[]);
        list.append(row);
      });
      section.append(list);
      if (!filtered.length) {
        const shortcut = commandShortcut(contexts.commands, createCommand);
        const title = query ? `No matches for "${query}"` : `No ${collectionDef.label.toLowerCase()} yet`;
        const hint = !query && shortcut ? kbdHint('Press ', shortcut, ' or click +') : undefined;
        const empty = emptyState(contexts.templates, title, hint);
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
      input: { on: 'input', selector: '.outline-title-search' },
      payload: ({ target }) => ({
        collectionId: (target as HTMLElement).dataset.collectionId!,
        query: (target as HTMLInputElement).value,
      }),
    }]);
    on('app.start', draw);
    on('outline.draw', draw);
    // Any fold of an outline section triggers a redraw — the section keeps its
    // header but drops the list. Unrelated fold ids (e.g. left-panel collapse)
    // are ignored so we don't repaint on every fold toggle in the app.
    on('fold.changed', ({ id }) => { if (id.startsWith('outline.collection.')) draw(); });
    on('outline.search.changed', ({ collectionId, query }) => {
      searches.set(collectionId, query);
      draw();
      queueMicrotask(() => {
        const next = contexts.places.el(Places.Left)?.querySelector(`.outline-title-search[data-collection-id="${collectionId}"]`) as HTMLInputElement | null;
        next?.focus();
        next?.setSelectionRange(next.value.length, next.value.length);
      });
    });
  }, { requires: ['render', 'graph'] });
}
