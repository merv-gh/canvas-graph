import { commandShortcut, itemFoldId, itemRefFrom, setIcon, type Registry } from '../core';
import type { ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'item.context.open': ItemRef;
    'context.selection.primary': ItemRef;
    'context.mobile.toggle': void;
    'context.title.focus': void;
    'context.title.commit': { ref: ItemRef; name: string };
  }
}

/** One item surface: the context command and period shortcut both open the
 * compact inspector rendered by configurable. Actions and editable properties
 * therefore cannot drift into separate modal designs. */
export function registerContextActions(system: Registry) {
  system('context.actions', ({ on, emit, bus, contexts, graphs, selection, declarePanel }) => {
    const refFrom = (target?: Element | null) => itemRefFrom(target) ?? selection.selected() ?? undefined;
    let redrawPending = false;
    let disposed = false;
    let mobileOpen = false;
    const redraw = () => {
      if (redrawPending) return;
      redrawPending = true;
      queueMicrotask(() => {
        redrawPending = false;
        if (!disposed) emit('tool.panel.redraw', { id: 'context' });
      });
    };
    const labelOf = (ref: ItemRef) => {
      const current = graphs.current.getItem(ref) as { Label?: { text?: string }; From?: string; To?: string } | undefined;
      const label = current?.Label?.text?.trim();
      if (label) return label;
      if (ref.kind === 'edge') {
        const endpointLabel = (id?: string) => {
          const endpointRef = id ? graphs.current.refById(id) : undefined;
          return endpointRef ? graphs.current.getItem<{ Label?: { text?: string } }>(endpointRef)?.Label?.text : undefined;
        };
        const from = endpointLabel(current?.From);
        const to = endpointLabel(current?.To);
        if (from && to) return `${from} → ${to}`;
      }
      return ref.id;
    };
    const action = (command: string, label: string, tone?: 'danger') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `context-panel-action${tone ? ` ${tone}` : ''}`;
      button.dataset.command = command;
      button.textContent = label;
      const shortcut = commandShortcut(contexts.commands, command);
      button.title = [contexts.commands.get(command)?.label, shortcut].filter(Boolean).join(' · ');
      return button;
    };
    const render = () => {
      const refs = selection.selectedAll();
      const root = document.createElement('div');
      root.className = 'context-panel';
      root.dataset.selectionCount = String(refs.length);
      root.dataset.mobileOpen = mobileOpen ? 'true' : 'false';

      const header = document.createElement('header');
      const search = document.createElement('button');
      search.type = 'button';
      search.className = 'context-search';
      search.dataset.command = 'palette.open';
      search.setAttribute('aria-label', 'Search commands and graph');
      search.innerHTML = '<span aria-hidden="true">⌕</span><span>Search commands…</span><kbd>P</kbd>';
      const state = document.createElement('span');
      state.className = 'context-state';
      state.textContent = refs.length ? `${refs.length} selected` : 'Canvas';
      const mobileToggle = document.createElement('button');
      mobileToggle.type = 'button';
      mobileToggle.className = 'context-mobile-toggle';
      mobileToggle.dataset.command = 'context.mobile.toggle';
      mobileToggle.textContent = mobileOpen ? 'Close' : 'Actions';
      mobileToggle.setAttribute('aria-expanded', mobileOpen ? 'true' : 'false');
      header.append(search, state, mobileToggle);
      root.append(header);
      const modeGroup = document.createElement('div');
      modeGroup.className = 'canvas-mode-group context-mode-group';
      const drawMode = action('ink.toggle', '');
      setIcon(drawMode, 'draw');
      drawMode.setAttribute('aria-label', 'Draw mode');
      const selectMode = action('canvas.select', '');
      setIcon(selectMode, 'select');
      selectMode.setAttribute('aria-label', 'Select mode');
      const eraseMode = action('ink.erase.toggle', '');
      setIcon(eraseMode, 'erase');
      eraseMode.setAttribute('aria-label', 'Erase canvas items');
      const stage = contexts.places.el('stage');
      drawMode.setAttribute('aria-pressed', stage?.classList.contains('ink-drawing') ? 'true' : 'false');
      selectMode.setAttribute('aria-pressed', contexts.cancellation.blocksPointer() ? 'false' : 'true');
      eraseMode.setAttribute('aria-pressed', stage?.classList.contains('ink-erasing') ? 'true' : 'false');
      modeGroup.append(drawMode, selectMode, eraseMode);
      header.prepend(modeGroup);

      if (refs.length) {
        const renameable = refs.length === 1 && (refs[0].kind === 'node' || refs[0].kind === 'container');
        if (renameable) {
          const ref = refs[0];
          const editor = document.createElement('div');
          editor.className = 'context-title-editor';
          editor.dataset.contextItemKind = ref.kind;
          editor.dataset.contextItemId = ref.id;
          const kind = document.createElement('small');
          kind.textContent = ref.kind;
          const input = document.createElement('input');
          input.type = 'text';
          input.value = labelOf(ref);
          input.dataset.contextTitle = '';
          input.dataset.contextItemKind = ref.kind;
          input.dataset.contextItemId = ref.id;
          input.setAttribute('aria-label', `Rename ${ref.kind}`);
          const pencil = document.createElement('button');
          pencil.type = 'button';
          pencil.className = 'context-title-pencil';
          pencil.dataset.command = 'context.title.focus';
          pencil.setAttribute('aria-label', `Edit ${ref.kind} name`);
          pencil.textContent = '✎';
          editor.append(kind, input, pencil);
          root.append(editor);
        } else {
          const list = document.createElement('div');
          list.className = 'context-selection-list';
          list.setAttribute('aria-label', 'Selected items');
          refs.forEach((ref, index) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'context-selection-item';
          row.dataset.command = 'context.selection.primary';
          row.dataset.contextItemKind = ref.kind;
          row.dataset.contextItemId = ref.id;
          const kind = document.createElement('small');
          kind.textContent = ref.kind;
          const label = document.createElement('span');
          label.textContent = labelOf(ref);
          if (index === refs.length - 1) row.setAttribute('aria-current', 'true');
          row.append(kind, label);
          list.append(row);
          });
          root.append(list);
        }
      } else {
        const empty = document.createElement('p');
        empty.className = 'context-panel-empty';
        empty.textContent = 'Nothing selected. Create on canvas.';
        root.append(empty);
      }

      const actions = document.createElement('div');
      actions.className = 'context-panel-actions';
      const primary = refs[refs.length - 1];
      const groupable = refs.filter(ref => ref.kind === 'node' || ref.kind === 'container');
      const nodesOnly = refs.length > 0 && refs.every(ref => ref.kind === 'node')
        && !!contexts.commands.get('palette.custom-type.create');
      const containerCount = graphs.current.itemsOfKind('container').length;
      const drawingsExist = graphs.current.itemsOfKind('ink').length > 0;
      if (!refs.length) {
        actions.append(
          action('editing.node.create', 'New node'),
          action('editing.container.create', 'New empty group'),
        );
      } else if (refs.length === 1 && primary) {
        actions.append(action('item.properties.open', 'Edit'));
        if (primary.kind === 'node' && graphs.current.getNode(primary.id)?.NodeType === 'toggle') {
          actions.append(action('node.toggle.state', graphs.current.getNode(primary.id)?.ToggleState ? 'Turn off' : 'Turn on'));
        }
        if (groupable.length) actions.append(action('selection.group', 'Wrap in group'));
        if (groupable.length && containerCount) actions.append(action('container.add-child', 'Move into…'));
        if (contexts.hierarchy.parentRefOf(primary)?.kind === 'container') actions.append(action('container.remove-child', 'Move out'));
        if (primary.kind === 'edge') actions.append(action('graph.edge.reverse', 'Reverse'));
        const selectedContainer = primary.kind === 'container'
          ? graphs.current.getItem<{ Children?: ItemRef[] }>(primary) : undefined;
        if (selectedContainer) {
          const folded = contexts.fold.folded(itemFoldId(primary, graphs.current.id));
          actions.append(action('item.collapse.toggle', folded ? 'Unfold' : 'Fold'));
        }
        if (selectedContainer?.Children?.length) actions.append(action('container.ungroup', 'Ungroup'));
        if (nodesOnly) actions.append(action('palette.custom-type.create', 'Create type from selection'));
        actions.append(action('selection.item.delete', 'Delete', 'danger'));
      } else {
        if (groupable.length === refs.length) actions.append(action('selection.group', 'Group selected'));
        if (nodesOnly) actions.append(action('palette.custom-type.create', 'Create type from selection'));
        actions.append(action('selection.item.delete', 'Delete selected', 'danger'));
      }
      if (drawingsExist) actions.append(action('ink.select.all', 'Select all drawings'));
      root.append(actions);
      return root;
    };

    declarePanel({
      id: 'context', anchor: 'middle-right', movable: false, layout: 'custom', render, order: 10,
      mountWhen: () => selection.selectedAll().length > 1,
    });

    contexts.commands.register([
      {
        id: 'item.context.open',
        label: 'Open item actions',
        group: 'item',
        shortcut: '.',
        input: { on: 'keydown', key: '.', prevent: true },
        available: source => !!refFrom(source?.target),
        payload: source => refFrom(source.target),
      },
      {
        id: 'context.selection.primary',
        label: 'Make selected item primary',
        group: 'item',
        hidden: true,
        payload: ({ target }) => {
          const row = target?.closest<HTMLElement>('[data-context-item-id]');
          const kind = row?.dataset.contextItemKind as ItemRef['kind'] | undefined;
          const id = row?.dataset.contextItemId;
          return kind && id ? { kind, id } as ItemRef : undefined;
        },
      },
      { id: 'context.mobile.toggle', label: 'Toggle Context panel actions', group: 'item', hidden: true },
      {
        id: 'context.title.focus', label: 'Edit selected item name', group: 'item', hidden: true,
      },
      {
        id: 'context.title.commit', label: 'Rename selected item', group: 'item', hidden: true,
        input: { on: 'change', selector: '[data-context-title]' },
        payload: ({ target }) => {
          const input = target?.closest<HTMLInputElement>('[data-context-title]');
          const kind = input?.dataset.contextItemKind as ItemRef['kind'] | undefined;
          const id = input?.dataset.contextItemId;
          return kind && id ? { ref: { kind, id }, name: input.value } : undefined;
        },
      },
    ]);
    on('item.context.open', ref => emit('item.properties.open', ref));
    on('context.selection.primary', ref => emit('selection.item.select', ref));
    on('context.mobile.toggle', () => { mobileOpen = !mobileOpen; redraw(); });
    on('context.title.focus', () => {
      queueMicrotask(() => {
        const input = contexts.places.el('stage')?.querySelector<HTMLInputElement>('[data-context-title]');
        input?.focus();
        input?.select();
      });
    });
    on('context.title.commit', ({ ref, name }) => {
      const text = name.trim();
      if (!text || text === labelOf(ref)) return;
      emit('item.update', { ref, patch: { Label: { text } } });
    });
    on('selection.changed', redraw);
    on('graph.switched', redraw);
    on('fold.changed', redraw);
    const offAny = bus.onAny(({ name }) => {
      if ((name.startsWith('graph.') || name.startsWith('container.') || name.startsWith('ink.'))
        && /\.(created|updated|deleted|changed)$/.test(name)) redraw();
    });
    return () => { disposed = true; offAny(); };
  }, { requires: ['ability.selectable'] });
}
