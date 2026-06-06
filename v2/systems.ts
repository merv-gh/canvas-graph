import type { GraphNode } from './model';
import {
  appendRenderable,
  clientPoint,
  entityUi,
  grouped,
  isStageSurface,
  itemIdFrom,
  nodeRect,
  shortcutOf,
  systemOf,
  uiValue,
  validateModel,
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
  system('render', ({ on, emit, graphs, contexts, model }) => {
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
      const graph = graphs.current;
      const el = contexts.templates.clone('node');
      const pos = node.Position ?? { x: 0, y: 0 };
      el.dataset.nodeId = node.id;
      el.classList.toggle('selected', graph.selected === node.id);
      el.classList.toggle('focused', graph.focused === node.id);
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
    const drawNodes = () => emit('render.view.set', {
      place: Places.Stage,
      key: 'nodes',
      view: () => {
        syncStageView();
        const view = contexts.view.get();
        const layer = contexts.templates.clone('nodes');
        layer.style.transform = `translate(${-view.x * view.scale}px, ${-view.y * view.scale}px) scale(${view.scale})`;
        graphs.current.nodes()
          .filter(node => contexts.view.isVisible(Places.Stage, nodeRect(node), 160))
          .forEach(node => layer.append(nodeView(node)));
        return layer;
      },
    });

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
    on('render.nodes.draw', drawNodes);
    on('view.changed', drawNodes);
  });

  system('input', ({ on, contexts }) => {
    on('app.start', () => contexts.input.start());
  });

  system('main', ({ on, emit, contexts }) => {
    on('app.start', () => {
      emit('render.shell');
      emit('render.view.set', {
        place: Places.Top,
        key: 'toolbar',
        view: () => contexts.templates.clone('toolbar'),
      });
    });
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
      collectionDef.items(ctx)
        .filter(item => collectionDef.itemLabel(item).toLowerCase().includes(query.toLowerCase()))
        .forEach(item => {
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

  system('modal', ({ on, emit, contexts }) => {
    let open = false;
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

  system('commandModal', ({ on, emit, contexts }) => {
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

  system('domain', ({ contexts, graphs }) => {
    let count = 1;
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
        available: source => !!itemIdFrom(source?.target) || !!graphs.current.selected,
        payload: source => ({ id: itemIdFrom(source.target) || graphs.current.selected || '' }),
      },
      {
        id: 'graph.delete.current',
        label: 'Delete graph',
        event: 'graph.delete',
        group: 'graph',
        available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
        payload: source => ({ id: graphId(source) }),
      },
    ]);
  });

  system('graph', ({ on, emit, graphs, contexts }) => {
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
      const node = graphs.current.node(draft, { at: contexts.view.spaceCenter(Places.Stage) });
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id });
    });
    on('graph.node.update', ({ id, patch }) => {
      if (graphs.current.updateNode(id, patch)) emit('graph.node.updated', { graphId: graphs.current.id, id });
    });
    on('graph.node.delete', ({ id }) => {
      if (graphs.current.deleteNode(id)) emit('graph.node.deleted', { graphId: graphs.current.id, id });
    });
    on('graph.delete', ({ id }) => {
      const next = graphs.delete(id);
      emit('graph.deleted', { id, nextId: next.id });
      emit('graph.switched', { id: next.id });
    });
  });

  system('view', ({ on, emit, contexts }) => {
    let pan: { pointer: { x: number; y: number }; view: ViewState } | null = null;
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

    on('view.zoom.by', ({ screen, factor }) => { contexts.view.zoomAtScreen(screen, factor); commit(); });
    on('view.zoom.in', () => centerZoom(1.2));
    on('view.zoom.out', () => centerZoom(1 / 1.2));
    on('view.zoom.reset', () => { contexts.view.set({ x: 0, y: 0, scale: 1 }); commit(); });
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

  system('focus', ({ on, emit, graphs }) => {
    on('focus.node.focus', ({ id }) => { graphs.current.focused = id; emit('focus.node.focused', { id }); });
    on('focus.node.clear', () => { graphs.current.focused = null; emit('focus.node.focused', { id: null }); });
  });

  system('dx', ({ on, contexts, model }) => {
    on('app.start', () => {
      const issues = validateModel({ entities: model.entities(), collections: model.collections() }, contexts.commands.all());
      if (issues.length) throw new Error(`DX model contract failed:\n${issues.join('\n')}`);
    });
  });
}
