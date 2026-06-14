import type { Registry } from '../core';
import { Places, Slots } from '../types';
import type { Position } from '../types';

declare module '../types' {
  interface CustomEvents {
    'tool.panel.drag.start': { id: string; x: number; y: number };
    'tool.panel.drag.move': { x: number; y: number };
    'tool.panel.drag.end': void;
    'tool.panel.moved': { id: string; position: Position };
  }
}

const TOP_PANEL_ID = 'top';
const TOP_PANEL_FOLD_ID = 'shell.top';
const LEFT_PANEL_FOLD_ID = 'outline.panel';
const ZEN_FOLD_ID = 'shell.zen';

export function registerToolPanel(system: Registry) {
  system('tool.panel', ({ on, emit, contexts }) => {
    const positions = new Map<string, Position>([[TOP_PANEL_ID, { x: 12, y: 12 }]]);
    let drag: { id: string; pointer: Position; start: Position } | null = null;

    const stageRect = () => contexts.places.el(Places.Stage)?.getBoundingClientRect();
    const clampPosition = (pos: Position) => {
      const rect = stageRect();
      if (!rect) return pos;
      return {
        x: Math.max(0, Math.min(pos.x, Math.max(0, rect.width - 48))),
        y: Math.max(0, Math.min(pos.y, Math.max(0, rect.height - 32))),
      };
    };
    const panelPosition = (id: string) => positions.get(id) ?? { x: 12, y: 12 };
    const isTopCollapsed = () =>
      contexts.fold.folded(TOP_PANEL_FOLD_ID) || contexts.fold.folded(ZEN_FOLD_ID);

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

    const leftPanelToggle = () => {
      const folded = !contexts.fold.isOpen(LEFT_PANEL_FOLD_ID, true);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-button hamburger';
      btn.dataset.foldId = LEFT_PANEL_FOLD_ID;
      btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      btn.setAttribute('aria-label', folded ? 'Show panel' : 'Hide panel');
      btn.textContent = '☰';
      return btn;
    };

    const topPanelToggle = () => {
      const collapsed = isTopCollapsed();
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tool-panel-collapse';
      btn.dataset.foldId = TOP_PANEL_FOLD_ID;
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', collapsed ? 'Expand toolbar' : 'Collapse toolbar');
      btn.textContent = collapsed ? '▾' : '▴';
      return btn;
    };

    const drawTopPanel = () => emit('render.view.set', {
      place: Places.Stage,
      key: 'tool-panel:top',
      view: () => {
        const collapsed = isTopCollapsed();
        const pos = panelPosition(TOP_PANEL_ID);
        const panel = document.createElement('section');
        panel.className = 'tool-panel top-tool-panel';
        panel.dataset.panelId = TOP_PANEL_ID;
        panel.dataset.collapsed = collapsed ? 'true' : 'false';
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;

        const head = document.createElement('div');
        head.className = 'tool-panel-head';
        head.append(dragHandle(TOP_PANEL_ID), topPanelToggle());
        panel.append(head);
        if (collapsed) return panel;

        const toolbar = contexts.templates.clone('toolbar');
        const start = contexts.templates.slot(toolbar, 'start');
        const end = contexts.templates.slot(toolbar, 'end');
        start.append(leftPanelToggle());
        contexts.affordances.system('top').forEach(aff => {
          const cmd = contexts.commands.get(aff.command);
          if (cmd?.available && !cmd.available()) return;
          const button = buttonFor(aff.command, aff.text ?? aff.command, aff.label);
          if (aff.className) button.classList.add(...aff.className.split(/\s+/).filter(Boolean));
          (aff.slot === Slots.End ? end : start).append(button);
        });
        panel.append(toolbar);
        return panel;
      },
    });

    on('tool.panel.drag.start', ({ id, x, y }) => {
      if (!id) return;
      drag = { id, pointer: { x, y }, start: panelPosition(id) };
    });
    on('tool.panel.drag.move', ({ x, y }) => {
      if (!drag) return;
      const position = clampPosition({
        x: drag.start.x + x - drag.pointer.x,
        y: drag.start.y + y - drag.pointer.y,
      });
      positions.set(drag.id, position);
      emit('tool.panel.moved', { id: drag.id, position });
      drawTopPanel();
    });
    on('tool.panel.drag.end', () => { drag = null; });

    on('app.start', drawTopPanel);
    on('affordance.contributed', ({ surface }) => { if (surface === 'top') drawTopPanel(); });
    on('fold.changed', ({ id }) => {
      if (id === TOP_PANEL_FOLD_ID || id === ZEN_FOLD_ID || id === LEFT_PANEL_FOLD_ID) drawTopPanel();
    });
    on('debug.enabled.changed', drawTopPanel);
    on('debug.recording.changed', drawTopPanel);
  }, { requires: ['render.stage'] });
}
