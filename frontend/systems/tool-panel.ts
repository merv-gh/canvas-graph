import type { Registry } from '../core';
import { Places, Slots } from '../types';
import type { PanelDef, Position } from '../types';

declare module '../types' {
  interface CustomEvents {
    'tool.panel.drag.start': { id: string; x: number; y: number };
    'tool.panel.drag.move': { x: number; y: number };
    'tool.panel.drag.end': void;
    'tool.panel.moved': { id: string; position: Position };
  }
}

const TOP_PANEL_ID = 'top';
const ZEN_FOLD_ID = 'shell.zen';

export function registerToolPanel(system: Registry) {
  system('tool.panel', ({ on, emit, contexts, declarePanel }) => {
    // Drag overrides only; un-dragged panels (incl. the fixed top toolbar)
    // position via their `data-anchor` CSS.
    const positions = new Map<string, Position>();
    // Render keys we have mounted, so a panel that goes away (origin teardown or
    // a false `mountWhen`) gets its stage view cleared instead of going stale.
    const mounted = new Set<string>();
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
      const x = panel.anchor.endsWith('right') && rect ? Math.max(margin, rect.width - 180 - margin) : margin;
      const y = panel.anchor === 'middle-right' && rect
        ? Math.max(margin, rect.height / 2 - 120)
        : panel.anchor.startsWith('bottom') && rect ? Math.max(margin, rect.height - 44 - margin) : margin;
      return { x, y };
    };
    const panelPosition = (panel: PanelDef) => positions.get(panel.id) ?? anchorPosition(panel);
    // Zen no longer collapses panels — it fades every panel to semi-transparent
    // via `.shell[data-zen] .tool-panel` CSS, so they stay in place, just quiet.
    const isCollapsed = (panel: PanelDef) => panel.foldId ? contexts.fold.folded(panel.foldId) : false;
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
      btn.textContent = collapsed ? '▾' : '▴';
      return btn;
    };

    const addButton = (parent: HTMLElement, aff: { command: string; text?: string; label?: string; className?: string }) => {
      const cmd = contexts.commands.get(aff.command);
      if (cmd?.available && !cmd.available()) return;
      const button = buttonFor(aff.command, aff.text ?? aff.command, aff.label);
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
      if (panel.mountWhen && !panel.mountWhen()) {
        if (mounted.delete(key)) emit('render.view.clear', { place: Places.Stage, key });
        return;
      }
      mounted.add(key);
      emit('render.view.set', {
        place: Places.Stage,
        key,
        view: () => {
          const collapsed = isCollapsed(panel);
          const section = document.createElement('section');
          section.className = `tool-panel${panel.layout === 'toolbar' ? ' top-tool-panel' : ' tool-panel-stack'}`;
          section.dataset.panelId = panel.id;
          section.dataset.collapsed = collapsed ? 'true' : 'false';
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
      const live = new Set(panels().map(p => keyOf(p.id)));
      for (const key of [...mounted]) {
        if (!live.has(key)) {
          emit('render.view.clear', { place: Places.Stage, key });
          mounted.delete(key);
        }
      }
      panels().forEach(drawPanel);
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

    on('app.start', drawPanels);
    on('affordance.contributed', ({ surface }) => { if (surface === 'top') drawPanels(); });
    on('fold.changed', ({ id }) => {
      if (id === ZEN_FOLD_ID || panels().some(p => p.foldId === id)) drawPanels();
    });
    on('debug.enabled.changed', drawPanels);
    on('debug.recording.changed', drawPanels);
    // Only panels with a `mountWhen` predicate care about selection changes;
    // skip the redraw entirely when none do (keeps the top panel untouched).
    on('selection.changed', () => { if (panels().some(p => p.mountWhen)) drawPanels(); });
  }, { requires: ['render.stage'] });
}
