import {
  collectionCreateCommand,
  collectionDeleteCommand,
  collectionKind,
  collectionSelectCommand,
  commandShortcut,
  emptyState,
  kbdHint,
  tagItem,
  type AppCollectionDef,
  type HierarchyNode,
  type Registry,
} from '../core';
import { Places } from '../types';
import type { Id, ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'outline.draw': void;
    'outline.search.changed': { collectionId: Id; query: string };
  }
}

/** outline — the left-pane navigator. It renders each collection as a *section*
 *  (preserving the collection/DX contract: every collection keeps its own
 *  search + create + delete), but lays the items out by HIERARCHY rather than
 *  flat: a kind that participates in the hierarchy shows its *roots*, with
 *  contained items nested + foldable beneath their parent. Loose nodes stay in
 *  the Nodes section; a node moved into a container leaves that flat list and
 *  appears nested under the container — nesting is visible in navigation, not
 *  just storage. Non-hierarchical kinds (graphs) render as flat leaves. */
export function registerOutline(system: Registry) {
  system('outline', ctx => {
    const { on, emit, contexts, model } = ctx;
    const hierarchy = contexts.hierarchy;
    const searches = new Map<string, string>();
    const el = (tag: string, className?: string, text?: string) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };

    /** kind → its declaring collection, so a nested child row (any kind) can
     *  wire the right select/delete commands. */
    const collectionsByKind = () => {
      const map = new Map<string, AppCollectionDef<unknown>>();
      model.collections().forEach(c => map.set(collectionKind(c), c as AppCollectionDef<unknown>));
      return map;
    };

    /** Render one hierarchy node (+ its kept descendants). Returns null when a
     *  search query is active and neither this node nor any descendant matches. */
    const renderRow = (
      node: HierarchyNode,
      parentIds: Id[],
      byKind: Map<string, AppCollectionDef<unknown>>,
      depth: number,
      query: string,
    ): HTMLElement | null => {
      const kind = node.ref.kind;
      const selfMatch = !query || (node.label ?? '').toLowerCase().includes(query);
      const childRows = node.children
        .map(child => renderRow(child, [...parentIds, node.ref.id], byKind, depth + 1, query))
        .filter((row): row is HTMLElement => !!row);
      if (query && !selfMatch && !childRows.length) return null;

      const coll = byKind.get(kind);
      const ref: ItemRef = parentIds.length ? { kind, id: node.ref.id, parent: parentIds } : { kind, id: node.ref.id };
      const wrap = el('div', 'outline-item');
      const row = el('div', `outline-row depth-${depth}`);
      tagItem(row, ref);

      // Fold toggle for items with children; search forces everything open so
      // matches deep in the tree are revealed.
      const foldId = `outline.item.${kind}:${node.ref.id}`;
      const open = query ? true : contexts.fold.isOpen(foldId, true);
      if (node.children.length) {
        const toggle = el('button', 'icon-button outline-fold', open ? '▾' : '▸');
        toggle.dataset.foldId = foldId;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        row.append(toggle);
      } else {
        row.append(el('span', 'outline-fold-spacer'));
      }

      const main = el('button', 'outline-main', node.label || node.ref.id);
      if (coll) main.dataset.command = collectionSelectCommand(coll);
      row.append(main);

      if (model.entity(kind)?.properties?.length) {
        const props = el('button', 'icon-button', '⚙');
        props.dataset.command = 'item.properties.open';
        row.append(props);
      }
      if (coll) {
        const remove = el('button', 'icon-button', 'x');
        remove.dataset.command = collectionDeleteCommand(coll);
        row.append(remove);
      }
      wrap.append(row);

      if (node.children.length && open) {
        const kids = el('div', 'outline-children');
        childRows.forEach(child => kids.append(child));
        wrap.append(kids);
      }
      return wrap;
    };

    const leafNode = (collectionDef: AppCollectionDef<unknown>, item: unknown): HierarchyNode => ({
      ref: { kind: collectionKind(collectionDef) as ItemRef['kind'], id: collectionDef.itemId(item) },
      label: collectionDef.itemLabel(item),
      children: [],
    });

    const renderSection = (
      collectionDef: AppCollectionDef<unknown>,
      forest: HierarchyNode[],
      hierarchical: Set<string>,
      byKind: Map<string, AppCollectionDef<unknown>>,
    ) => {
      const kind = collectionKind(collectionDef);
      const section = el('section', 'outline-section');
      section.dataset.collectionId = collectionDef.id;
      const foldId = `outline.collection.${collectionDef.id}`;
      const open = contexts.fold.isOpen(foldId, true);
      section.classList.toggle('folded', !open);

      const head = el('div', 'outline-head');
      const foldTrigger = el('button', 'icon-button outline-fold', open ? '▾' : '▸');
      foldTrigger.dataset.foldId = foldId;
      foldTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      foldTrigger.setAttribute('aria-label', open ? `Collapse ${collectionDef.label}` : `Expand ${collectionDef.label}`);
      const query = searches.get(collectionDef.id) ?? '';
      const title = el('input', 'panel-title outline-title-search') as HTMLInputElement;
      title.placeholder = collectionDef.label;
      title.value = query;
      title.dataset.collectionId = collectionDef.id;
      title.setAttribute('aria-label', `Search ${collectionDef.label.toLowerCase()}`);
      const createButton = el('button', 'icon-button', '+') as HTMLButtonElement;
      createButton.dataset.command = collectionCreateCommand(collectionDef);
      head.append(foldTrigger, title, createButton);
      section.append(head);
      if (!open) return section;

      // Hierarchical kinds render their roots (nested); others render flat leaves.
      const roots = hierarchical.has(kind)
        ? forest.filter(node => node.ref.kind === kind)
        : collectionDef.items(ctx).map(item => leafNode(collectionDef, item));
      const q = query.trim().toLowerCase();
      const list = el('div', 'outline-list');
      const rows = roots.map(root => renderRow(root, [], byKind, 0, q)).filter((row): row is HTMLElement => !!row);
      rows.forEach(row => list.append(row));
      section.append(list);

      if (!rows.length) {
        const totalItems = collectionDef.items(ctx).length;
        const shortcut = commandShortcut(contexts.commands, collectionCreateCommand(collectionDef));
        const label = collectionDef.label.toLowerCase();
        const title = q ? `No matches for "${query}"`
          : roots.length === 0 && totalItems > 0 ? `All ${label} are nested`
          : `No ${label} yet`;
        const hint = !q && !totalItems && shortcut ? kbdHint('Press ', shortcut, ' or click +') : undefined;
        const empty = emptyState(contexts.templates, title, hint);
        if (empty) section.append(empty);
      }
      return section;
    };

    const renderOutline = () => {
      const panel = el('section', 'outline');
      const forest = hierarchy.tree();
      const hierarchical = new Set(hierarchy.items().map(item => item.ref.kind));
      const byKind = collectionsByKind();
      model.collections().forEach(collectionDef =>
        panel.append(renderSection(collectionDef as AppCollectionDef<unknown>, forest, hierarchical, byKind)),
      );
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
    // Any outline fold (section OR item) re-renders. Unrelated fold ids (e.g.
    // the left-panel collapse) are ignored so we don't repaint on every toggle.
    on('fold.changed', ({ id }) => { if (id.startsWith('outline.')) draw(); });
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
