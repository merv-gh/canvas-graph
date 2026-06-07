import type { GraphNode } from './model';
import {
  appendRenderable,
  clientPoint,
  commandShortcut,
  emptyState,
  entityUi,
  grouped,
  isStageSurface,
  itemIdFrom,
  nodeRect,
  runDx,
  shortcutOf,
  systemOf,
  uiValue,
  type AppCollectionDef,
  type Registry,
} from './core';
import { Places } from './types';
import type {
  ActionDef,
  AffordanceDef,
  AppEvents,
  CommandSource,
  CommandSpec,
  Place,
  Renderable,
  ViewState,
} from './types';

type CommandModalDef = {
  id: 'palette' | 'help';
  title: string;
  event: 'palette.open' | 'help.open';
  label: string;
  shortcut: string;
  key: string;
  editableHotkeys: boolean;
  availableOnly: boolean;
  placeholder: string;
};

const commandModals: Record<CommandModalDef['id'], CommandModalDef> = {
  palette: { id: 'palette', title: 'Palette', event: 'palette.open', label: 'Open palette', shortcut: 'P', key: 'p', editableHotkeys: false, availableOnly: true, placeholder: 'Search commands' },
  help: { id: 'help', title: 'Help', event: 'help.open', label: 'Open help', shortcut: '?', key: '?', editableHotkeys: true, availableOnly: false, placeholder: 'Search shortcuts' },
};

export function registerSystems(system: Registry) {
  system('render', ({ on, emit, bus, graphs, contexts, model, selection }) => {
    const root = document.getElementById('app')!;
    const views = new Map<Place, Map<string, Renderable>>();
    const applyAffordance = (el: HTMLElement, node: GraphNode, ui: AffordanceDef<GraphNode>) => {
      if (ui.className) el.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => el.setAttribute(name, uiValue(value, node)));
    };
    const affordanceButton = (node: GraphNode, actionDef: ActionDef<GraphNode>, ui: AffordanceDef<GraphNode>) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = ui.command;
      button.textContent = uiValue(ui.text, node, actionDef.label);
      button.setAttribute('aria-label', uiValue(ui.label, node, actionDef.label));
      applyAffordance(button, node, ui);
      return button;
    };
    const wireNodeAffordances = (el: HTMLElement, node: GraphNode) => {
      const entityDef = model.entity<GraphNode>(node.kind);
      if (!entityDef) return;
      entityUi(entityDef, 'header')
        .filter(({ ui }) => ui.kind === 'handler')
        .forEach(({ ui }) => applyAffordance(contexts.templates.slot(el, 'header'), node, ui));
      entityUi(entityDef, 'title')
        .filter(({ ui }) => ui.kind === 'handler')
        .forEach(({ ui }) => applyAffordance(contexts.templates.slot(el, 'title'), node, ui));
      (['header:start', 'header:end'] as const).forEach(slot => {
        const target = contexts.templates.slot(el, slot);
        entityUi(entityDef, slot)
          .filter(({ ui }) => ui.kind === 'button')
          .forEach(({ action, ui }) => target.append(affordanceButton(node, action, ui)));
      });
    };
    const syncStageView = () => {
      const stage = contexts.places.el(Places.Stage), view = contexts.view.get();
      if (!stage) return;
      stage.style.setProperty('--grid-size', `${32 * view.scale}px`);
      stage.style.setProperty('--grid-x', `${-view.x * view.scale}px`);
      stage.style.setProperty('--grid-y', `${-view.y * view.scale}px`);
      stage.dataset.zoom = `${Math.round(view.scale * 100)}%`;
    };
    const flush = (place: Place) => {
      const slot = contexts.places.el(place), parts = views.get(place);
      if (!slot || !parts) return;
      slot.replaceChildren();
      [...parts.values()].forEach(view => appendRenderable(slot, view));
    };
    const nodeView = (node: GraphNode) => {
      const el = contexts.templates.clone('node');
      const pos = node.Position ?? { x: 0, y: 0 };
      el.dataset.nodeId = node.id;
      el.classList.toggle('selected', selection.selected() === node.id);
      el.classList.toggle('focused', selection.focused() === node.id);
      el.classList.toggle('collapsed', !!node.Collapsed);
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.style.width = `${node.Size.w}px`;
      el.style.height = `${node.Size.h}px`;
      contexts.templates.text(el, 'title', node.Label.text);
      contexts.templates.text(el, 'meta', node.id);
      wireNodeAffordances(el, node);
      return el;
    };
    const drawNodes = () => {
      emit('render.view.set', {
        place: Places.Stage,
        key: 'nodes',
        view: () => {
          syncStageView();
          const view = contexts.view.get();
          const layer = contexts.templates.clone('nodes');
          layer.style.transform = `translate(${-view.x * view.scale}px, ${-view.y * view.scale}px) scale(${view.scale})`;
          // Edges first so they sit behind node DOM (which is appended after).
          const svg = contexts.templates.slot(layer, 'edges');
          const SVG_NS = 'http://www.w3.org/2000/svg';
          graphs.current.edges().forEach(edge => {
            const from = graphs.current.getNode(edge.From);
            const to = graphs.current.getNode(edge.To);
            if (!from?.Position || !to?.Position) return;
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', String(from.Position.x));
            line.setAttribute('y1', String(from.Position.y));
            line.setAttribute('x2', String(to.Position.x));
            line.setAttribute('y2', String(to.Position.y));
            line.dataset.edgeId = edge.id;
            svg.append(line);
            if (edge.Label?.text) {
              const text = document.createElementNS(SVG_NS, 'text');
              text.setAttribute('class', 'edge-label');
              text.setAttribute('x', String((from.Position.x + to.Position.x) / 2));
              text.setAttribute('y', String((from.Position.y + to.Position.y) / 2 - 4));
              text.setAttribute('text-anchor', 'middle');
              text.textContent = edge.Label.text;
              svg.append(text);
            }
          });
          graphs.current.nodes()
            .filter(node => contexts.view.isVisible(Places.Stage, nodeRect(node), 160))
            .forEach(node => layer.append(nodeView(node)));
          return layer;
        },
      });
      // Empty-state hint (rendered outside the transformed node layer so it stays centered).
      const all = graphs.current.nodes();
      if (!all.length) {
        emit('render.view.set', {
          place: Places.Stage,
          key: 'empty',
          view: () => {
            const shortcut = commandShortcut(contexts.commands, 'editing.node.create');
            const hint = shortcut ? `Press <kbd>${shortcut}</kbd> to add a node` : '';
            return emptyState(contexts, 'No nodes in this graph yet', hint) ?? '';
          },
        });
      } else {
        emit('render.view.clear', { place: Places.Stage, key: 'empty' });
      }
    };

    on('render.shell', () => {
      root.replaceChildren(contexts.templates.clone('shell'));
      Object.values(Places).forEach(place => contexts.places.set(place, root.querySelector(`[data-place="${place}"]`)));
      syncStageView();
      Object.values(Places).forEach(flush);
    });
    on('render.view.set', ({ place, key = 'default', view }) => {
      (views.get(place) || views.set(place, new Map()).get(place)!).set(key, view);
      flush(place);
    });
    on('render.view.clear', ({ place, key }) => { key ? views.get(place)?.delete(key) : views.delete(place); flush(place); });

    /* ----- dirty-flag scheduler -----
       One rAF per frame, coalesces every data mutation into at most one redraw.
       Event-name patterns drive scope; explicit `render.*.draw` events still work as escape hatches.
       This is what lets features.ts stay short — it no longer ferries redraw events. */
    const dirty = new Set<'nodes' | 'outline'>();
    let scheduled = false;
    const flushDirty = () => {
      scheduled = false;
      if (dirty.has('nodes')) drawNodes();
      if (dirty.has('outline')) emit('outline.draw');
      dirty.clear();
    };
    const mark = (...scopes: ('nodes' | 'outline')[]) => {
      scopes.forEach(s => dirty.add(s));
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flushDirty);
    };
    // Initial draw at app.start so the empty state shows before any data mutation happens.
    on('app.start', () => mark('nodes'));
    bus.onAny(({ name }) => {
      if (name === 'render.nodes.draw') return mark('nodes');
      if (name === 'outline.draw') return; // already a redraw signal — outline handles it
      if (name.startsWith('render.')) return;
      if (name === 'view.changed') return mark('nodes');
      // Data mutations + selection/focus changes refresh both surfaces.
      if (/(?:^graph\.(?:switched|deleted)$|^graph\.node\.(?:created|updated|deleted)$|^graph\.edge\.(?:created|updated|deleted)$|^(?:selection|focus)\.node\.(?:selected|focused)$)/.test(name)) {
        return mark('nodes', 'outline');
      }
      if (name === 'graph.created') return mark('outline');
    });
  });

  system('input', ({ on, contexts }) => {
    on('app.start', () => contexts.input.start());
  });

  system('main', ({ on, emit, contexts }) => {
    const drawToolbar = () => emit('render.view.set', {
      place: Places.Top,
      key: 'toolbar',
      view: () => {
        const root = contexts.templates.clone('toolbar');
        const start = contexts.templates.slot(root, 'start');
        const end = contexts.templates.slot(root, 'end');
        contexts.affordances.for('top').forEach(aff => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.command = aff.command;
          button.textContent = aff.text ?? aff.command;
          if (aff.label) button.setAttribute('aria-label', aff.label);
          if (aff.className) button.classList.add(...aff.className.split(/\s+/).filter(Boolean));
          // Convention: slot=='end' aligns right; everything else lands in start.
          (aff.slot === 'end' ? end : start).append(button);
        });
        return root;
      },
    });
    on('app.start', () => { emit('render.shell'); drawToolbar(); });
    // Re-render when a system contributes a new affordance after boot.
    on('affordance.contributed', ({ surface }) => { if (surface === 'top') drawToolbar(); });
  });

  system('log', ({ bus, emit, contexts }) => {
    const rows: string[] = [];
    const renderLog = () => {
      const panel = contexts.templates.clone('log');
      const list = contexts.templates.slot(panel, 'rows');
      rows.forEach(row => {
        const item = contexts.templates.clone('log-row');
        contexts.templates.text(item, 'name', row);
        list.append(item);
      });
      return panel;
    };
    bus.onAny(event => {
      if (event.name.startsWith('render.')) return;
      rows.unshift(event.name);
      rows.length = Math.min(rows.length, 12);
      emit('render.view.set', {
        place: Places.Left,
        key: 'log',
        view: renderLog,
      });
    });
  });

  // Re-declare outline with requires below.
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
        if (collectionDef.id === 'graphs') row.dataset.graphId = id;
        if (collectionDef.id === 'nodes') row.dataset.nodeId = id;
        const main = el('button', 'outline-main', collectionDef.itemLabel(item)) as HTMLButtonElement;
        if (collectionDef.selectCommand) main.dataset.command = collectionDef.selectCommand;
        const remove = el('button', 'icon-button', 'x') as HTMLButtonElement;
        remove.dataset.command = collectionDef.crud.delete;
        row.append(main, remove);
        list.append(row);
      });
      section.append(list);
      // Empty-state when the collection has no items (or query produced no matches).
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

  system('modal', ({ on, emit, contexts, contribute }) => {
    let open = false;
    contribute({ surface: 'top', command: 'modal.open', kind: 'button', text: 'Modal', order: 50 });
    contexts.commands.register([
      {
        id: 'modal.open',
        label: 'Open modal',
        event: 'modal.open',
        group: 'modal',
        payload: ({ target }) => ({ title: (target as HTMLElement)?.dataset.title, body: (target as HTMLElement)?.dataset.body, visual: (target as HTMLElement)?.dataset.visual as AppEvents['modal.open']['visual'] }),
      },
      { id: 'modal.close', label: 'Close modal', event: 'modal.close', group: 'modal', shortcut: 'Esc', input: { on: 'keydown', key: 'Escape', global: true, when: () => open, prevent: true } },
    ]);

    on('modal.close', () => {
      open = false;
      emit('render.view.set', { place: Places.Modal, key: 'modal', view: '' });
    });
    on('modal.open', ({ title = 'Modal', body = '', visual = 'panel' }) => {
      open = true;
      emit('render.view.set', {
        place: Places.Modal,
        key: 'modal',
        view: () => {
          const modal = contexts.templates.clone('modal');
          modal.dataset.visual = visual;
          contexts.templates.text(modal, 'title', title);
          appendRenderable(contexts.templates.slot(modal, 'body'), body);
          return modal;
        },
      });
      queueMicrotask(() => (contexts.places.el(Places.Modal)?.querySelector('[autofocus]') as HTMLElement | null)?.focus());
    });
  });

  system('commandModal', ({ on, emit, contexts, contribute }) => {
    contribute({ surface: 'top', command: 'palette.open', kind: 'button', text: 'Palette', order: 30 });
    contribute({ surface: 'top', command: 'help.open', kind: 'button', text: 'Help', order: 40 });
    const syncShortcutConflict = (input: HTMLInputElement) => {
      const conflict = contexts.commands.shortcutConflict(input.dataset.shortcutCommand!, input.value);
      input.classList.toggle('is-conflict', !!conflict);
      input.toggleAttribute('aria-invalid', !!conflict);
      input.title = conflict ? `Already used by ${conflict.label}` : '';
      input.closest('.help-row')?.classList.toggle('has-conflict', !!conflict);
      return !conflict;
    };
    const visibleCommands = (modal: CommandModalDef, query = '') => {
      const q = query.trim().toLowerCase();
      return contexts.commands.all()
        .filter(command => !command.hidden)
        .filter(command => !modal.availableOnly || command.available?.() !== false)
        .filter(command => !q || `${command.id} ${command.label} ${command.group ?? ''} ${shortcutOf(command)}`.toLowerCase().includes(q));
    };
    const commandSection = (modal: CommandModalDef, group: string, commands: CommandSpec[]) => {
      const section = contexts.templates.clone('command-section');
      const rows = contexts.templates.slot(section, 'rows');
      contexts.templates.text(section, 'group', group);
      commands.forEach(command => {
        const shortcut = shortcutOf(command);
        const row = contexts.templates.clone<HTMLElement>(modal.editableHotkeys ? 'help-row' : 'command-row');
        if (!modal.editableHotkeys) row.dataset.command = command.id;
        contexts.templates.text(row, 'label', command.label);
        contexts.templates.text(row, 'id', command.id);
        if (modal.editableHotkeys) {
          const input = row.querySelector('input');
          if (input) {
            input.dataset.shortcutCommand = command.id;
            input.value = shortcut;
            input.setAttribute('aria-label', `${command.label} shortcut`);
            syncShortcutConflict(input);
          }
        } else if (shortcut) contexts.templates.text(row, 'shortcut', shortcut);
        else row.querySelector('kbd')?.remove();
        rows.append(row);
      });
      return section;
    };
    const renderList = (modal: CommandModalDef, query = '') => {
      const fragment = document.createDocumentFragment();
      grouped(visibleCommands(modal, query), command => command.group ?? systemOf(command.id))
        .forEach(([group, commands]) => fragment.append(commandSection(modal, group, commands)));
      return fragment;
    };
    const renderCommandModal = (modal: CommandModalDef) => {
      const palette = contexts.templates.clone('palette');
      palette.dataset.commandModal = modal.id;
      const input = palette.querySelector('.palette-search');
      if (input instanceof HTMLInputElement) input.placeholder = modal.placeholder;
      contexts.templates.slot(palette, 'commands').append(renderList(modal));
      return palette;
    };
    contexts.commands.register([
      ...Object.values(commandModals).map(modal => ({
        id: modal.event,
        label: modal.label,
        event: modal.event,
        group: 'modal',
        shortcut: modal.shortcut,
        input: { on: 'keydown', key: modal.key, prevent: true },
      }) satisfies CommandSpec),
      {
        id: 'commandModal.search.change',
        label: 'Search command modal',
        event: 'commandModal.search.changed',
        group: 'modal',
        hidden: true,
        input: { on: 'input', selector: '.palette-search' },
        payload: ({ target }) => {
          const root = target?.closest('[data-command-modal]');
          return {
            modalId: root instanceof HTMLElement ? root.dataset.commandModal ?? '' : '',
            query: (target as HTMLInputElement).value,
          };
        },
      },
      {
        id: 'shortcut.edit.preview',
        label: 'Preview shortcut edit',
        event: 'shortcut.edit.preview',
        group: 'modal',
        hidden: true,
        input: { on: 'input', selector: '.shortcut-edit' },
        payload: ({ target }) => ({ id: (target as HTMLElement).dataset.shortcutCommand!, shortcut: (target as HTMLInputElement).value }),
      },
      {
        id: 'shortcut.edit.commit',
        label: 'Commit shortcut edit',
        event: 'shortcut.edit.commit',
        group: 'modal',
        hidden: true,
        input: { on: 'change', selector: '.shortcut-edit' },
        payload: ({ target }) => ({ id: (target as HTMLElement).dataset.shortcutCommand!, shortcut: (target as HTMLInputElement).value }),
      },
    ]);
    const open = (modal: CommandModalDef) => emit('modal.open', {
      title: modal.title,
      visual: 'command',
      body: () => renderCommandModal(modal),
    });
    on('palette.open', () => open(commandModals.palette));
    on('help.open', () => open(commandModals.help));
    on('commandModal.search.changed', ({ modalId, query }) => {
      const modal = commandModals[modalId as CommandModalDef['id']];
      const root = document.querySelector(`[data-command-modal="${modalId}"]`);
      const list = root?.querySelector('[data-slot="commands"]');
      if (modal && list) list.replaceChildren(renderList(modal, query));
    });
    on('shortcut.edit.preview', ({ id }) => {
      const input = document.querySelector(`.shortcut-edit[data-shortcut-command="${id}"]`);
      if (input instanceof HTMLInputElement) syncShortcutConflict(input);
    });
    on('shortcut.edit.commit', ({ id }) => {
      const input = document.querySelector(`.shortcut-edit[data-shortcut-command="${id}"]`);
      if (!(input instanceof HTMLInputElement) || !syncShortcutConflict(input)) return;
      contexts.commands.setShortcut(id, input.value);
    });
  });

  system('domain', ({ contexts, graphs, selection, contribute }) => {
    let count = 1;
    contribute({ surface: 'top', command: 'editing.node.create', kind: 'button', text: '+ Node', order: 10 });
    contribute({ surface: 'top', command: 'graph.create', kind: 'button', text: '+ Graph', order: 20 });
    const graphId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.id;
    const nextGraphId = () => graphs.all().find(graph => graph.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

    contexts.commands.register([
      {
        id: 'editing.node.create',
        label: 'Create node',
        event: 'editing.node.create',
        group: 'editing',
        shortcut: 'A',
        input: { on: 'keydown', key: 'a', prevent: true },
        payload: () => ({ Label: { text: `Node ${count++}` } }),
      },
      {
        id: 'graph.create',
        label: 'Create graph',
        event: 'graph.create',
        group: 'graph',
        shortcut: 'N',
        input: { on: 'keydown', key: 'n', prevent: true },
      },
      {
        id: 'graph.switch.next',
        label: 'Switch graph',
        event: 'graph.switch',
        group: 'graph',
        shortcut: 'G',
        input: { on: 'keydown', key: 'g', prevent: true },
        payload: () => ({ id: nextGraphId() }),
      },
      {
        id: 'graph.switch.item',
        label: 'Switch graph item',
        event: 'graph.switch',
        group: 'graph',
        hidden: true,
        payload: source => ({ id: graphId(source) }),
      },
      {
        id: 'graph.node.delete.selected',
        label: 'Delete node',
        event: 'graph.node.delete',
        group: 'graph',
        shortcut: 'Delete',
        input: { on: 'keydown', key: 'Delete', prevent: true },
        available: source => !!itemIdFrom(source?.target) || !!selection.selected(),
        payload: source => ({ id: itemIdFrom(source.target) || selection.selected() || '' }),
      },
      {
        id: 'graph.delete.current',
        label: 'Delete graph',
        event: 'graph.delete',
        group: 'graph',
        available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
        payload: source => ({ id: graphId(source) }),
      },
      // Edge CRUD. Surfaced as commands so the palette can find them and DX won't warn.
      // `graph.edge.create` with no source defaults to a self-loop on the selected node, which is
      // useful as a smoke trigger; UI to pick From/To deserves its own picker modal (future work).
      {
        id: 'graph.edge.create',
        label: 'Create edge',
        event: 'graph.edge.create',
        group: 'edge',
        available: source => !!itemIdFrom(source?.target) || !!selection.selected(),
        payload: source => {
          const id = itemIdFrom(source.target) || selection.selected() || '';
          return { From: id, To: id };
        },
      },
      {
        id: 'graph.edge.delete.selected',
        label: 'Delete edge',
        event: 'graph.edge.delete',
        group: 'edge',
        available: source => !!itemIdFrom(source?.target),
        payload: source => ({ id: itemIdFrom(source.target) }),
      },
    ]);
  });

  system('graph', ({ on, emit, graphs, contexts, selection }) => {
    on('graph.create', () => {
      const graph = graphs.create();
      graphs.switch(graph.id);
      emit('graph.created', { id: graph.id });
      emit('graph.switched', { id: graph.id });
    });
    on('graph.switch', ({ id }) => {
      const graph = graphs.switch(id);
      emit('graph.switched', { id: graph.id });
    });
    on('graph.node.create', draft => {
      const { relativeTo, keepFocus, connectFrom, ...store } = draft as typeof draft & { relativeTo?: string; keepFocus?: boolean; connectFrom?: string };
      // Explicit relativeTo wins; else last selected; else view center.
      const anchorNode = relativeTo ? graphs.current.getNode(relativeTo) : (selection.selectedNode() as GraphNode | undefined);
      const node = graphs.current.createNode(store, {
        at: contexts.view.spaceCenter(Places.Stage),
        nearPosition: anchorNode?.Position,
      });
      // Pass hints through the fact event so features.nodeLifecycle can act on them.
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id, hints: { keepFocus, connectFrom, relativeTo } });
    });
    on('graph.node.update', ({ id, patch }) => {
      if (graphs.current.updateNode(id, patch)) emit('graph.node.updated', { graphId: graphs.current.id, id });
    });
    on('graph.node.delete', ({ id }) => {
      // Snapshot incident edges before cascade so we can emit per-edge facts.
      const incident = graphs.current.edgesOf(id).map(e => e.id);
      if (graphs.current.deleteNode(id)) {
        incident.forEach(eid => emit('graph.edge.deleted', { graphId: graphs.current.id, id: eid }));
        emit('graph.node.deleted', { graphId: graphs.current.id, id });
      }
    });
    on('graph.edge.create', draft => {
      const edge = graphs.current.createEdge(draft);
      emit('graph.edge.created', { graphId: graphs.current.id, id: edge.id, edge });
    });
    on('graph.edge.delete', ({ id }) => {
      if (graphs.current.deleteEdge(id)) emit('graph.edge.deleted', { graphId: graphs.current.id, id });
    });
    on('graph.delete', ({ id }) => {
      const next = graphs.delete(id);
      emit('graph.deleted', { id, nextId: next.id });
      emit('graph.switched', { id: next.id });
    });
  });

  // Camera (zoom + fit). Keyboard + wheel + toolbar. Independent of pan.
  system('view.zoom', ({ on, emit, contexts, graphs, selection, contribute }) => {
    contribute({ surface: 'top', command: 'view.zoom.out', kind: 'button', text: '−', slot: 'end', order: 10 });
    contribute({ surface: 'top', command: 'view.zoom.reset', kind: 'button', text: '100%', slot: 'end', order: 20 });
    contribute({ surface: 'top', command: 'view.zoom.in', kind: 'button', text: '+', slot: 'end', order: 30 });
    contribute({ surface: 'top', command: 'view.fit.all', kind: 'button', text: 'Fit', slot: 'end', order: 5 });
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());
    const centerZoom = (factor: number) => {
      contexts.view.zoomAtScreen(contexts.view.screenCenter(Places.Stage), factor);
      commit();
    };

    contexts.commands.register([
      {
        id: 'view.zoom.wheel',
        label: 'Wheel zoom',
        event: 'view.zoom.by',
        group: 'view',
        hidden: true,
        input: { on: 'wheel', selector: stageSelector, prevent: true },
        payload: ({ event }) => {
          const wheel = event as WheelEvent;
          return {
            screen: contexts.view.clientToScreen(Places.Stage, { x: wheel.clientX, y: wheel.clientY }),
            factor: Math.exp(-wheel.deltaY * 0.001),
          };
        },
      },
      { id: 'view.zoom.in', label: 'Zoom in', event: 'view.zoom.in', group: 'view', shortcut: '+', input: { on: 'keydown', key: '+', prevent: true } },
      { id: 'view.zoom.out', label: 'Zoom out', event: 'view.zoom.out', group: 'view', shortcut: '-', input: { on: 'keydown', key: '-', prevent: true } },
      { id: 'view.zoom.reset', label: 'Reset view', event: 'view.zoom.reset', group: 'view', shortcut: '0', input: { on: 'keydown', key: '0', prevent: true } },
      { id: 'view.fit.all', label: 'Fit all to view', event: 'view.fit.all', group: 'view', shortcut: 'Z', input: { on: 'keydown', key: 'z', prevent: true } },
      { id: 'view.fit.selected', label: 'Fit selected to view', event: 'view.fit.selected', group: 'view', shortcut: 'Shift+Z', input: { on: 'keydown', key: 'Z', shift: true, prevent: true }, available: () => !!selection.selected() },
    ]);

    on('view.zoom.by', ({ screen, factor }) => { contexts.view.zoomAtScreen(screen, factor); commit(); });
    on('view.zoom.in', () => centerZoom(1.2));
    on('view.zoom.out', () => centerZoom(1 / 1.2));
    on('view.zoom.reset', () => { contexts.view.set({ x: 0, y: 0, scale: 1 }); commit(); });

    /** Compute the world-space bounding box of a set of nodes. */
    const nodesBounds = (ns: GraphNode[]) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ns.forEach(n => {
        if (!n.Position) return;
        const w = n.Size.w / 2, h = n.Size.h / 2;
        minX = Math.min(minX, n.Position.x - w);
        minY = Math.min(minY, n.Position.y - h);
        maxX = Math.max(maxX, n.Position.x + w);
        maxY = Math.max(maxY, n.Position.y + h);
      });
      return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    };
    /** Set camera so the given world-space bbox fills the visible stage area.
     *  Padding is in stage *pixels*, NOT world units — that's the only way to guarantee a
     *  uniform reserved gutter at every zoom level (the old world-space padding shrank with
     *  scale, so nodes on the bbox edge stuck out behind whatever framed the stage). */
    const fitToBounds = (b: { minX: number; minY: number; maxX: number; maxY: number }, pixelPadding = 40) => {
      const stage = contexts.places.el(Places.Stage);
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      // Reserve `pixelPadding` on every side of the stage. If the stage is smaller than the
      // padding we'd reserve, give up and use what we have.
      const fittableW = Math.max(1, rect.width - 2 * pixelPadding);
      const fittableH = Math.max(1, rect.height - 2 * pixelPadding);
      const bw = Math.max(1, b.maxX - b.minX);
      const bh = Math.max(1, b.maxY - b.minY);
      const scale = Math.min(2, Math.min(fittableW / bw, fittableH / bh));
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      contexts.view.set({
        x: cx - rect.width / (2 * scale),
        y: cy - rect.height / (2 * scale),
        scale,
      });
      commit();
    };
    on('view.fit.all', () => {
      const b = nodesBounds(graphs.current.nodes() as GraphNode[]);
      if (b) fitToBounds(b);
    });
    on('view.fit.selected', () => {
      const node = selection.selectedNode() as GraphNode | undefined;
      if (!node) return;
      const b = nodesBounds([node]);
      if (b) fitToBounds(b, 180);
    });
  });

  // Camera (pan). Pointer drag on the stage background. Independent of zoom.
  system('view.pan', ({ on, emit, contexts }) => {
    let pan: { pointer: { x: number; y: number }; view: ViewState } | null = null;
    const stageSelector = `[data-place="${Places.Stage}"]`;
    const commit = () => emit('view.changed', contexts.view.get());

    contexts.commands.register([
      {
        id: 'view.pan.start',
        label: 'Start canvas pan',
        event: 'view.pan.start',
        group: 'view',
        hidden: true,
        input: { on: 'pointerdown', selector: stageSelector, when: isStageSurface, prevent: true },
        payload: ({ event }) => clientPoint(event!),
      },
      {
        id: 'view.pan.move',
        label: 'Pan canvas',
        event: 'view.pan.move',
        group: 'view',
        hidden: true,
        input: { on: 'pointermove', when: () => !!pan, prevent: true },
        payload: ({ event }) => clientPoint(event!),
      },
      { id: 'view.pan.end', label: 'End canvas pan', event: 'view.pan.end', group: 'view', hidden: true, input: { on: 'pointerup', when: () => !!pan } },
    ]);

    on('view.pan.start', pointer => {
      pan = { pointer, view: contexts.view.get() };
      contexts.places.el(Places.Stage)?.classList.add('panning');
    });
    on('view.pan.move', pointer => {
      if (!pan) return;
      contexts.view.set({
        x: pan.view.x - (pointer.x - pan.pointer.x) / pan.view.scale,
        y: pan.view.y - (pointer.y - pan.pointer.y) / pan.view.scale,
      });
      commit();
    });
    on('view.pan.end', () => {
      pan = null;
      contexts.places.el(Places.Stage)?.classList.remove('panning');
    });
  });

  system('focus', ({ on, emit, selection }) => {
    on('focus.node.focus', ({ id }) => { selection.focus(id); emit('focus.node.focused', { id }); });
    on('focus.node.clear', () => { selection.focus(null); emit('focus.node.focused', { id: null }); });
  });

  /* `layout` arranges existing nodes geometrically. Three strategies cover most cases:
       radial : ring around focused root (good for fan-out)
       grid   : sqrt(n) x sqrt(n) grid (good for unsorted inspection)
       tidy   : level-by-level using edge direction (good for hierarchical graphs)
     Each emits `graph.node.update` per node so the dirty scheduler picks up one redraw. */
  system('layout', ({ on, emit, contexts, graphs, selection, contribute }) => {
    contribute({ surface: 'top', command: 'layout.apply.tidy', kind: 'button', text: 'Tidy', order: 65 });
    contribute({ surface: 'top', command: 'layout.apply.radial', kind: 'button', text: 'Radial', order: 66 });
    contexts.commands.register([
      { id: 'layout.apply.radial', label: 'Radial layout', event: 'layout.apply.radial', group: 'layout', input: { on: 'keydown', key: 'r', prevent: true } },
      { id: 'layout.apply.grid',   label: 'Grid layout',   event: 'layout.apply.grid',   group: 'layout', input: { on: 'keydown', key: 'G', shift: true, prevent: true } },
      { id: 'layout.apply.tidy',   label: 'Tidy tree layout', event: 'layout.apply.tidy', group: 'layout', input: { on: 'keydown', key: 't', prevent: true } },
    ]);

    on('layout.apply.radial', () => {
      const g = graphs.current;
      const focusedId = selection.focused() ?? selection.selected();
      const all = g.nodes();
      const root = focusedId ? g.getNode(focusedId) : all[0];
      if (!root) return;
      const others = all.filter(n => n.id !== root.id);
      const radius = Math.max(160, 60 + others.length * 22);
      const center = root.Position ?? { x: 0, y: 0 };
      others.forEach((n, i) => {
        const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
        emit('graph.node.update', { id: n.id, patch: { Position: { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius } } });
      });
    });

    on('layout.apply.grid', () => {
      const all = graphs.current.nodes();
      const cols = Math.max(1, Math.ceil(Math.sqrt(all.length)));
      const colSize = 200, rowSize = 100;
      const startX = -((cols - 1) * colSize) / 2;
      const startY = -((Math.ceil(all.length / cols) - 1) * rowSize) / 2;
      all.forEach((n, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        emit('graph.node.update', { id: n.id, patch: { Position: { x: startX + col * colSize, y: startY + row * rowSize } } });
      });
    });

    on('layout.apply.tidy', () => {
      // Edge direction = parent → child. Roots have no incoming edges.
      const g = graphs.current;
      const all = g.nodes();
      const inDeg = new Map<string, number>(all.map(n => [n.id, 0]));
      g.edges().forEach(e => inDeg.set(e.To, (inDeg.get(e.To) ?? 0) + 1));
      const roots = all.filter(n => (inDeg.get(n.id) ?? 0) === 0);
      if (!roots.length) return;
      // BFS to assign levels.
      const level = new Map<string, number>();
      const queue: string[] = [];
      roots.forEach(r => { level.set(r.id, 0); queue.push(r.id); });
      while (queue.length) {
        const id = queue.shift()!;
        const lv = level.get(id)!;
        g.edges().filter(e => e.From === id).forEach(e => {
          if (!level.has(e.To)) { level.set(e.To, lv + 1); queue.push(e.To); }
        });
      }
      // Group by level and lay out horizontally, level-by-level.
      const byLevel = new Map<number, string[]>();
      all.forEach(n => {
        const lv = level.get(n.id) ?? 0;
        (byLevel.get(lv) ?? byLevel.set(lv, []).get(lv)!).push(n.id);
      });
      const rowH = 130;
      byLevel.forEach((ids, lv) => {
        const spread = (ids.length - 1) * 180;
        ids.forEach((id, i) => {
          emit('graph.node.update', { id, patch: { Position: { x: -spread / 2 + i * 180, y: lv * rowH } } });
        });
      });
    });
  });

  /* `demo` is dogfood: render the running system as a graph of its own concepts.
     It intentionally exercises the create path enough times to surface what's missing —
     edges (we encode deps as body text), layout (we hand-pick positions), and batch ops
     (a create-with-edge command would halve the script). All three should become next
     systems; this demo is the receipt. */
  system('demo', ({ on, emit, contexts, graphs, flags, selection, contribute }) => {
    contribute({ surface: 'top', command: 'demo.render-self', kind: 'button', text: '★ Self', order: 60 });
    contexts.commands.register([{
      id: 'demo.render-self',
      label: 'Render self-graph',
      event: 'demo.run-self',
      group: 'demo',
    }]);

    on('demo.run-self', () => {
      const stats = { events: 0, nodeEvents: 0, edgeEvents: 0, focusEvents: 0, layoutEvents: 0 };
      const bus = contexts.commands;                       // alias for readability below
      // Reset the current graph by deleting every node — cascade removes their edges.
      graphs.current.nodes().slice().forEach(node => {
        emit('graph.node.delete', { id: node.id }); stats.events++; stats.nodeEvents++;
      });
      // Create root, then a node per concept with connectFrom=root and keepFocus so focus
      // stays anchored. The layout system will position; the view will fit. The script
      // never touches Position itself — that's a feature, not a workaround.
      emit('editing.node.create', { Label: { text: 'core' } }); stats.events++; stats.nodeEvents++;
      // Selection is now on the new root. Capture it.
      const root = selection.selected();
      if (!root) return;
      // Focus root (so layout.radial uses it as center, and the loop has a stable anchor).
      emit('focus.node.focus', { id: root }); stats.events++; stats.focusEvents++;

      const groups: Array<{ prefix: string; items: string[] }> = [
        { prefix: '',         items: ['render', 'input', 'main', 'log', 'outline', 'modal', 'commandModal',
                                       'domain', 'graph', 'view.zoom', 'view.pan', 'focus', 'layout', 'dx', 'demo'] },
        { prefix: 'ability.', items: ['selectable', 'draggable', 'nudgeable', 'collapsible', 'editable', 'configurable'] },
        { prefix: 'feature.', items: ['nodeLifecycle'] },
      ];

      groups.forEach(({ prefix, items }) => items.forEach(name => {
        const flagName = prefix + name;
        // Just the system name — relationship is carried by the real edge, not a text hint.
        emit('editing.node.create', {
          Label: { text: flagName },
          connectFrom: root,
          keepFocus: true,
        });
        stats.events += 2;                                 // editing.create AND the connectFrom edge
        stats.nodeEvents++;
        stats.edgeEvents++;
      }));

      // Hand the layout system the responsibility of placing nodes. Tidy uses the directed
      // edges we built (root → each child); radial fans them around the focused root.
      emit('layout.apply.tidy'); stats.events++; stats.layoutEvents++;
      // Frame what we drew.
      emit('view.fit.all'); stats.events++;

      const refs = bus;                                    // suppress unused warning
      void refs;

      console.info('[demo] self-graph rendered via bus', {
        ...stats,
        passedThrough: 'editing.node.create + connectFrom + keepFocus + layout.apply.tidy + view.fit.all',
        gapsRemaining: [
          'Edge labels (e.g. "depends-on") not yet set on connectFrom-created edges — need a hint.',
          'Long titles overflow the fixed node size — need auto-size from content.',
          'No way yet to encode "this node represents a flag with state X" — could be a properties-driven badge.',
          '`outline` shows nodes but not edges — edge collection needed in appModel.',
        ],
      });
    });
  });

  // Dependency map — colocated for readability. setRequires patches the entry post-hoc.
  // Only declare deps the system *actively uses*; soft "would be nice" deps stay implicit.
  const deps: Record<string, string[]> = {
    render: ['input'],
    main: ['render'],
    log: ['render'],
    outline: ['render', 'graph'],
    modal: ['render'],
    commandModal: ['modal'],
    domain: ['graph'],
    'view.zoom': ['render'],
    'view.pan': ['render'],
    focus: ['graph'],
    layout: ['graph'],
    demo: ['graph', 'render'],
  };
  Object.entries(deps).forEach(([name, list]) => system.setRequires(name, list));

  system('dx', (ctx) => {
    // Run synchronously after all `app.start` handlers have had a chance to subscribe.
    // We run as a microtask so we go AFTER the rest of the `app.start` callback chain.
    ctx.on('app.start', () => {
      queueMicrotask(() => {
        const issues = runDx(ctx);
        ctx.contexts.dx._set(issues);
        const errors = issues.filter(i => i.level === 'error');
        const warns = issues.filter(i => i.level === 'warn');
        if (errors.length) {
          console.error('[dx] errors:');
          errors.forEach(i => console.error(`  ${i.rule}: ${i.message}`));
          throw new Error(`DX contract failed (${errors.length} error${errors.length > 1 ? 's' : ''}). See console.`);
        }
        if (warns.length) {
          console.warn(`[dx] ${warns.length} warning(s):`);
          warns.forEach(i => console.warn(`  ${i.rule}: ${i.message}`));
        } else {
          console.info('[dx] all checks passed');
        }
      });
    });
  });
}
