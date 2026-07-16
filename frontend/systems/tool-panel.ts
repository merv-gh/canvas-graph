import { commandShortcut, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { PanelDef, Place, Position } from '../types';

declare module '../types' {
  interface CustomEvents {
    'tool.panel.drag.start': { id: string; x: number; y: number };
    'tool.panel.drag.move': { x: number; y: number };
    'tool.panel.drag.end': void;
    'tool.panel.moved': { id: string; position: Position };
    'tool.panel.mobile.toggle': void;
  }
}

const TOP_PANEL_ID = 'top';
const ZEN_FOLD_ID = 'shell.zen';

export function registerToolPanel(system: Registry) {
  system('tool.panel', ({ on, emit, bus, contexts, declarePanel }) => {
    // Drag overrides only; un-dragged panels (incl. the fixed top toolbar)
    // position via their `data-anchor` CSS.
    const positions = new Map<string, Position>();
    // Render keys we have mounted, so a panel that goes away (origin teardown or
    // a false `mountWhen`) gets its stage view cleared instead of going stale.
    const mounted = new Map<string, Place>();
    let mobileOpen = false;
    let drag: { id: string; pointer: Position; start: Position } | null = null;

    const keyOf = (id: string) => `tool-panel:${id}`;
    const stageRect = () => contexts.places.el(Places.Stage)?.getBoundingClientRect();
    const clampPosition = (pos: Position) => {
      const rect = stageRect();
      if (!rect) return pos;
      return {
        x: Math.max(0, Math.min(pos.x, Math.max(0, rect.width - 48))),
        y: Math.max(0, Math.min(pos.y, Math.max(0, rect.height - 32))),
      };
    };
    const panels = () => contexts.affordances.panels();
    const panelById = (id: string) => panels().find(p => p.id === id);
    // Approximate anchor position — used only as a drag start point for a panel
    // that has never been dragged (otherwise CSS owns the resting position).
    const anchorPosition = (panel: PanelDef): Position => {
      const rect = stageRect();
      const margin = 12;
      const x = panel.anchor === 'bottom-center' && rect
        ? Math.max(margin, rect.width / 2 - 90)
        : panel.anchor.endsWith('right') && rect ? Math.max(margin, rect.width - 180 - margin) : margin;
      const y = panel.anchor === 'middle-right' && rect
        ? Math.max(margin, rect.height / 2 - 120)
        : panel.anchor.startsWith('bottom') && rect ? Math.max(margin, rect.height - 44 - margin) : margin;
      return { x, y };
    };
    const panelPosition = (panel: PanelDef) => positions.get(panel.id) ?? anchorPosition(panel);
    const isCollapsed = (panel: PanelDef) => panel.foldId ? contexts.fold.folded(panel.foldId) : false;
    const placeFor = (panel: PanelDef) => panel.id === TOP_PANEL_ID ? Places.Top : Places.Stage;
    const buttonsFor = (panelId: string) =>
      contexts.affordances.system('top').filter(aff => (aff.panel ?? TOP_PANEL_ID) === panelId);

    // The top toolbar is the default panel. It is fixed (not movable, not
    // collapsible) and centered at the top of the stage — the one piece of
    // chrome that stays put. Zen still hides it (isCollapsed folds top on zen).
    declarePanel({ id: TOP_PANEL_ID, anchor: 'top-center', movable: false, layout: 'toolbar', order: 0 });

    contexts.commands.register([
      {
        id: 'tool.panel.drag.start',
        label: 'Start moving tool panel',
        group: 'tool-panel',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-tool-panel-drag]', prevent: true, stop: true },
        payload: ({ event, target }) => ({
          id: (target as HTMLElement).dataset.toolPanelDrag ?? '',
          x: (event as PointerEvent).clientX,
          y: (event as PointerEvent).clientY,
        }),
      },
      {
        id: 'tool.panel.drag.move',
        label: 'Move tool panel',
        group: 'tool-panel',
        hidden: true,
        input: { on: 'pointermove', when: () => !!drag, prevent: true, stop: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      {
        id: 'tool.panel.drag.end',
        label: 'Stop moving tool panel',
        group: 'tool-panel',
        hidden: true,
        input: { on: 'pointerup', when: () => !!drag, stop: true },
      },
      { id: 'tool.panel.mobile.toggle', label: 'Toggle mobile actions', group: 'tool-panel', hidden: true },
    ]);

    const buttonFor = (commandId: string, text: string, label?: string) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = commandId;
      button.textContent = text;
      if (label) button.setAttribute('aria-label', label);
      return button;
    };

    const dragHandle = (id: string) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'tool-panel-drag';
      handle.dataset.toolPanelDrag = id;
      handle.setAttribute('aria-label', 'Move tool panel');
      handle.textContent = '⋮⋮';
      return handle;
    };

    const collapseToggle = (panel: PanelDef, collapsed: boolean) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-panel-collapse';
      btn.dataset.foldId = panel.foldId ?? '';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
      btn.textContent = collapsed ? '⊞' : '⊟';
      return btn;
    };

    const addButton = (parent: HTMLElement, aff: { command: string; text?: string; label?: string; className?: string; active?: () => boolean }) => {
      const cmd = contexts.commands.get(aff.command);
      if (cmd?.available && !cmd.available()) return;
      const text = aff.text ?? aff.command;
      const button = buttonFor(aff.command, text, aff.label);
      const shortcut = commandShortcut(contexts.commands, aff.command);
      const description = !aff.label && cmd?.label !== text ? cmd?.label : undefined;
      if (description) button.setAttribute('aria-description', description);
      button.title = [description, shortcut].filter(Boolean).join(' · ');
      if (aff.active) button.setAttribute('aria-pressed', aff.active() ? 'true' : 'false');
      if (aff.className) button.classList.add(...aff.className.split(/\s+/).filter(Boolean));
      parent.append(button);
    };

    // Buttons that share an affordance `group` cluster into a `.tool-group`
    // wrapper (its slot fixed by first appearance), so related actions read as
    // one unit — "graph editing" vs "layout" — instead of a flat button run.
    const groupTarget = (start: HTMLElement, groups: Map<string, HTMLElement>, group?: string) => {
      if (!group) return start;
      let el = groups.get(group);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tool-group';
        el.dataset.group = group;
        start.append(el);
        groups.set(group, el);
      }
      return el;
    };

    // The top panel keeps the toolbar template (start/end slots); start-slot
    // buttons are clustered into `.tool-group`s, end-slot buttons (search) stay
    // pinned right.
    const fillToolbar = (panel: PanelDef, section: HTMLElement) => {
      const toolbar = contexts.templates.clone('toolbar');
      const start = contexts.templates.slot(toolbar, 'start');
      const end = contexts.templates.slot(toolbar, 'end');
      if (panel.id === TOP_PANEL_ID) {
        const brand = document.createElement('span');
        brand.className = 'toolbar-brand';
        brand.setAttribute('aria-label', 'Canvas Graph — visual editor for systems, flows, and ideas');
        brand.title = 'Visual editor for systems, flows, and ideas';
        const name = document.createElement('b');
        name.textContent = 'Canvas';
        const kind = document.createElement('span');
        kind.textContent = 'Graph';
        brand.append(name, kind);
        toolbar.prepend(brand);
        const actions = buttonFor('tool.panel.mobile.toggle', 'Actions', 'Show editing actions');
        actions.className = 'mobile-actions-toggle';
        actions.setAttribute('aria-expanded', mobileOpen ? 'true' : 'false');
        end.prepend(actions);
      }
      const groups = new Map<string, HTMLElement>();
      buttonsFor(panel.id).forEach(aff => {
        if (aff.slot === Slots.End) addButton(end, aff);
        else addButton(groupTarget(start, groups, aff.group), aff);
      });
      section.append(toolbar);
    };

    const fillStack = (panel: PanelDef, section: HTMLElement) => {
      const body = document.createElement('div');
      body.className = 'tool-panel-body';
      buttonsFor(panel.id).forEach(aff => addButton(body, aff));
      section.append(body);
    };

    const drawPanel = (panel: PanelDef) => {
      const key = keyOf(panel.id);
      const place = placeFor(panel);
      if (panel.mountWhen && !panel.mountWhen()) {
        if (mounted.delete(key)) emit('render.view.clear', { place, key });
        return;
      }
      mounted.set(key, place);
      emit('render.view.set', {
        place,
        key,
        view: () => {
          const collapsed = isCollapsed(panel);
          const section = document.createElement('section');
          section.className = `tool-panel${panel.layout === 'toolbar' ? ' top-tool-panel' : ' tool-panel-stack'}`;
          section.dataset.panelId = panel.id;
          section.dataset.collapsed = collapsed ? 'true' : 'false';
          section.dataset.mobileOpen = mobileOpen ? 'true' : 'false';
          const dragged = positions.get(panel.id);
          if (dragged) {
            section.style.left = `${dragged.x}px`;
            section.style.top = `${dragged.y}px`;
          } else {
            section.dataset.anchor = panel.anchor;
          }

          const head = document.createElement('div');
          head.className = 'tool-panel-head';
          if (panel.movable) head.append(dragHandle(panel.id));
          if (panel.foldId) head.append(collapseToggle(panel, collapsed));
          if (head.childElementCount) section.append(head);
          if (collapsed) return section;

          if (panel.layout === 'toolbar') fillToolbar(panel, section);
          else fillStack(panel, section);
          return section;
        },
      });
    };

    const drawPanels = () => {
      const focused = document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>('[data-command]')?.dataset.command
        : undefined;
      const live = new Set(panels().map(p => keyOf(p.id)));
      for (const [key, place] of [...mounted]) {
        if (!live.has(key)) {
          emit('render.view.clear', { place, key });
          mounted.delete(key);
        }
      }
      panels().forEach(drawPanel);
      if (focused) {
        const shell = contexts.places.el(Places.Top)?.parentElement;
        const replacement = [...(shell?.querySelectorAll<HTMLElement>('[data-command]') ?? [])]
          .find(button => button.dataset.command === focused);
        replacement?.focus({ preventScroll: true });
      }
    };

    on('tool.panel.drag.start', ({ id, x, y }) => {
      const panel = panelById(id);
      if (!panel) return;
      drag = { id, pointer: { x, y }, start: panelPosition(panel) };
    });
    on('tool.panel.drag.move', ({ x, y }) => {
      if (!drag) return;
      const position = clampPosition({
        x: drag.start.x + x - drag.pointer.x,
        y: drag.start.y + y - drag.pointer.y,
      });
      positions.set(drag.id, position);
      emit('tool.panel.moved', { id: drag.id, position });
      drawPanels();
    });
    on('tool.panel.drag.end', () => { drag = null; });
    on('tool.panel.mobile.toggle', () => { mobileOpen = !mobileOpen; drawPanels(); });

    const closeMobileActions = () => {
      if (!mobileOpen) return;
      mobileOpen = false;
      drawPanels();
    };
    const offAny = bus.onAny(({ name }) => {
      if (!mobileOpen) return;
      const mobileActionEvents = new Set(buttonsFor(TOP_PANEL_ID)
        .filter(affordance => affordance.slot !== Slots.End)
        .map(affordance => {
          const command = contexts.commands.get(affordance.command);
          return command?.event ?? command?.id;
        })
        .filter((event): event is string => !!event));
      if (mobileActionEvents.has(name)) queueMicrotask(closeMobileActions);
    });
    on('modal.open', closeMobileActions);
    on('commandPicker.open', closeMobileActions);
    on('graph.switched', closeMobileActions);

    on('app.start', drawPanels);
    on('affordance.contributed', ({ surface }) => { if (surface === 'top') drawPanels(); });
    on('fold.changed', ({ id }) => {
      if (id === ZEN_FOLD_ID || panels().some(p => p.foldId === id)) drawPanels();
    });
    on('debug.enabled.changed', drawPanels);
    on('debug.recording.changed', drawPanels);
    on('history.changed', drawPanels);
    // Only panels with a `mountWhen` predicate care about selection changes;
    // skip the redraw entirely when none do (keeps the top panel untouched).
    on('selection.changed', () => { if (panels().some(p => p.mountWhen)) drawPanels(); });
    return () => offAny();
  }, { requires: ['render.stage'] });
}
