import { clamp, itemFoldId, itemRefFrom, tagItem, uiValue, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { ActionDef, AffordanceDef, EntityDef, ItemRef, Position } from '../types';

declare module '../types' {
  interface CustomEvents {
    'item.action.hold.start': { ref: ItemRef; x: number; y: number; pointerId: number };
    'item.action.hold.move': { x: number; y: number; pointerId: number };
    'item.action.hold.end': { pointerId: number };
    'item.action.open': { ref: ItemRef; x?: number; y?: number };
    'item.action.close': void;
    'item.action.run': { command: string };
    'item.action.add': void;
  }
}

const HOLD_MS = 460;
const HOLD_SLOP = 12;

type WheelAction = { command: string; glyph: string; label: string; danger?: boolean };

/** Selected-item toolbar for pointer desktops plus a Krita-style radial action
 * wheel for compact/touch work. Both surfaces reuse canonical commands; the
 * wheel only changes disclosure and target acquisition. */
export function registerItemToolbar(system: Registry) {
  system('item.toolbar', ({ on, emit, contexts, graphs, model, selection, origin }) => {
    let hold: { ref: ItemRef; start: Position; pointerId: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let wheelOpen = false;
    const clearToolbar = () => emit('render.view.clear', { place: Places.Stage, key: 'item-toolbar' });
    const clearWheel = () => emit('render.view.clear', { place: Places.Stage, key: 'item-action-wheel' });
    const sameRef = (a: ItemRef | null, b: ItemRef) => !!a && a.kind === b.kind && a.id === b.id;

    const cancelHold = () => {
      if (!hold) return;
      clearTimeout(hold.timer);
      hold = null;
      contexts.places.el(Places.Stage)?.classList.remove('holding-action');
    };
    const closeWheel = () => {
      cancelHold();
      if (!wheelOpen) return;
      wheelOpen = false;
      clearWheel();
    };

    const buildButton = (item: unknown, action: ActionDef<unknown>, ui: AffordanceDef<unknown>, ref: ItemRef) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = ui.command;
      button.textContent = uiValue(ui.text, item, action.label);
      let label = uiValue(ui.label, item, action.label);
      if (ui.command === 'item.collapse.toggle') {
        const folded = contexts.fold.folded(itemFoldId(ref, graphs.current.id));
        button.textContent = folded ? '⊞' : '⊟';
        label = folded ? 'Maximize item' : 'Minimize item';
      }
      button.setAttribute('aria-label', label);
      button.title = label;
      if (ui.className) button.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => button.setAttribute(name, uiValue(value, item)));
      return button;
    };

    const buildHandler = (item: unknown, ui: AffordanceDef<unknown>, text: string) => {
      const span = document.createElement('span');
      if (ui.className) span.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => span.setAttribute(name, uiValue(value, item)));
      span.textContent = text;
      return span;
    };

    const buildToolbar = (entityDef: EntityDef<unknown>, item: unknown, ref: ItemRef) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'item-toolbar node-toolbar';
      tagItem(wrapper, ref);
      const renderer = entityDef.render;
      const fallbackPos = (item as { Position?: Position }).Position
        ?? contexts.hierarchy.anchor(ref)
        ?? { x: 0, y: 0 };
      const fallbackSize = (item as { Size?: { w: number; h: number } }).Size ?? { w: 0, h: 0 };
      const rect = renderer?.bounds?.(item) ?? {
        x: fallbackPos.x - fallbackSize.w / 2,
        y: fallbackPos.y - fallbackSize.h / 2,
        w: fallbackSize.w,
        h: fallbackSize.h,
      };
      const screen = contexts.view.spaceToScreen({ x: rect.x + rect.w / 2, y: rect.y });
      const stage = contexts.places.el(Places.Stage);
      const stageWidth = stage?.getBoundingClientRect().width || window.innerWidth;
      const leftPanel = contexts.places.el(Places.Left)?.getBoundingClientRect();
      const minX = leftPanel && leftPanel.width > 0 ? leftPanel.right + 44 : 0;
      wrapper.style.left = `${Math.max(screen.x, minX)}px`;
      wrapper.style.top = `${Math.max(screen.y, stageWidth <= 680 ? 104 : 88)}px`;

      const append = (slot: string, kind: 'button' | 'handler', handlerText = '', baseClass = '') => {
        contexts.affordances.entity(entityDef, slot).forEach(({ action, ui }) => {
          if (ui.when && !ui.when(item)) return;
          if (ui.kind !== kind) return;
          const el = kind === 'button'
            ? buildButton(item, action, ui, ref)
            : buildHandler(item, ui, handlerText);
          if (baseClass) el.classList.add(baseClass);
          wrapper.append(el);
        });
      };
      append(Slots.Drag, 'handler', '⋮⋮', 'node-drag-handle');
      append(Slots.HeaderStart, 'button');
      append(Slots.HeaderEnd, 'button');
      return wrapper;
    };

    const wheelActions = (ref: ItemRef, root: HTMLElement): WheelAction[] => {
      const canMoveInto = ref.kind !== 'edge'
        && graphs.current.itemsOfKind('container').some(container => (container as { id: string }).id !== ref.id);
      const common: WheelAction[] = [
        { command: 'item.title.edit', glyph: 'Aa', label: 'Rename' },
        { command: 'item.properties.open', glyph: '⋯', label: 'Details' },
        ...(canMoveInto ? [{ command: 'container.add-child', glyph: '↳', label: 'Move into' }] : []),
      ];
      const contextual = ref.kind === 'node'
        ? [
            { command: 'item.action.add', glyph: '+', label: 'Add connected' },
            { command: 'editing.edge.create', glyph: '↗', label: 'Connect' },
            { command: 'item.collapse.toggle', glyph: '−', label: 'Fold' },
          ]
        : ref.kind === 'edge'
          ? [{ command: 'graph.edge.reverse', glyph: '⇄', label: 'Reverse' }]
          : [
              { command: 'editing.node.create', glyph: '+', label: 'Add node' },
              { command: 'item.collapse.toggle', glyph: '−', label: 'Fold' },
            ];
      const actions: WheelAction[] = [
        ...common,
        ...contextual,
        { command: 'selection.item.delete', glyph: '×', label: 'Delete', danger: true },
      ];
      return actions.filter(action => {
        if (action.command === 'editing.edge.create' && graphs.current.nodes().length < 2) return false;
        const command = contexts.commands.get(action.command);
        return !!command && contexts.commands.isEnabled(command)
          && command.available?.({ target: root, origin: 'pointer' }) !== false;
      });
    };

    const wheelAnchor = (ref: ItemRef, x?: number, y?: number) => {
      const stage = contexts.places.el(Places.Stage);
      const rect = stage?.getBoundingClientRect();
      const anchor = contexts.hierarchy.anchor(ref);
      const fallback = anchor ? contexts.view.spaceToScreen(anchor) : contexts.view.screenCenter(Places.Stage);
      const raw = {
        x: x == null ? fallback.x : x - (rect?.left ?? 0),
        y: y == null ? fallback.y : y - (rect?.top ?? 0),
      };
      const width = rect?.width || window.innerWidth;
      const height = rect?.height || window.innerHeight;
      return {
        x: width < 236 ? width / 2 : clamp(raw.x, 118, width - 118),
        y: height < 260 ? height / 2 : clamp(raw.y, 138, height - 122),
      };
    };

    const renderWheel = (ref: ItemRef, x?: number, y?: number) => {
      const item = graphs.current.getItem(ref);
      const entityDef = model.entity(ref.kind);
      if (!item || !entityDef) return document.createDocumentFragment();
      const root = document.createElement('div');
      root.className = 'item-action-wheel';
      root.setAttribute('role', 'menu');
      root.setAttribute('aria-label', `${entityDef.labelOf(item)} actions`);
      tagItem(root, ref);
      const anchor = wheelAnchor(ref, x, y);
      root.style.left = `${anchor.x}px`;
      root.style.top = `${anchor.y}px`;
      const actions = wheelActions(ref, root);
      const radius = actions.length > 4 ? 88 : 78;
      actions.forEach((action, index) => {
        const angle = -Math.PI / 2 + index * (Math.PI * 2 / actions.length);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `item-action-choice${action.danger ? ' danger' : ''}`;
        button.dataset.command = 'item.action.run';
        button.dataset.actionCommand = action.command;
        button.dataset.interactionCost = action.command === 'editing.edge.create' || action.command === 'container.add-child' ? '3' : '2';
        button.style.setProperty('--wheel-x', `${Math.cos(angle) * radius}px`);
        button.style.setProperty('--wheel-y', `${Math.sin(angle) * radius}px`);
        button.setAttribute('aria-label', action.label);
        button.setAttribute('role', 'menuitem');
        const glyph = document.createElement('b');
        glyph.textContent = action.glyph;
        const label = document.createElement('span');
        label.textContent = action.label;
        button.append(glyph, label);
        root.append(button);
      });
      const center = document.createElement('button');
      center.type = 'button';
      center.className = 'item-action-center';
      center.dataset.command = 'item.action.close';
      center.setAttribute('aria-label', 'Close item actions');
      center.innerHTML = '<span>Done</span>';
      root.append(center);
      return root;
    };

    const openWheel = ({ ref, x, y }: { ref: ItemRef; x?: number; y?: number }) => {
      cancelHold();
      if (!graphs.current.getItem(ref)) return;
      if (!sameRef(selection.selected(), ref)) emit('selection.item.select', ref);
      wheelOpen = true;
      emit('render.view.set', {
        place: Places.Stage,
        key: 'item-action-wheel',
        view: () => renderWheel(ref, x, y),
      });
    };

    contexts.commands.register([
      {
        id: 'item.action.hold.start', label: 'Start item long press', group: 'item', hidden: true,
        input: {
          on: 'pointerdown', selector: '[data-item-kind][data-item-id]',
          when: event => {
            const pointer = event as PointerEvent;
            const touchLike = pointer.pointerType === 'touch'
              || (globalThis.innerWidth <= 680 && pointer.pointerType !== 'mouse');
            return touchLike
              && !(event.target as Element).closest('[data-command], [data-drag-handle], [data-resize-handle], input, textarea, select');
          },
        },
        payload: ({ event, target }) => {
          const pointer = event as PointerEvent;
          const ref = itemRefFrom(target);
          return ref ? { ref, x: pointer.clientX, y: pointer.clientY, pointerId: pointer.pointerId } : undefined;
        },
      },
      {
        id: 'item.action.hold.move', label: 'Track item long press', group: 'item', hidden: true,
        input: { on: 'pointermove', when: () => !!hold },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY, pointerId: (event as PointerEvent).pointerId }),
      },
      {
        id: 'item.action.hold.end', label: 'End item long press', group: 'item', hidden: true,
        input: { on: 'pointerup', when: () => !!hold },
        payload: ({ event }) => ({ pointerId: (event as PointerEvent).pointerId }),
      },
      {
        id: 'item.action.context', label: 'Open item action wheel', event: 'item.action.open', group: 'item', hidden: true,
        input: { on: 'contextmenu', selector: '[data-item-kind][data-item-id]', prevent: true, stop: true },
        payload: ({ event, target }) => {
          const ref = itemRefFrom(target);
          const pointer = event as MouseEvent;
          return ref ? { ref, x: pointer.clientX, y: pointer.clientY } : undefined;
        },
      },
      { id: 'item.action.close', label: 'Close item actions', group: 'item', hidden: true },
      {
        id: 'item.action.run', label: 'Run item wheel action', group: 'item', hidden: true,
        payload: ({ target }) => ({ command: target?.closest<HTMLElement>('[data-action-command]')?.dataset.actionCommand ?? '' }),
      },
      { id: 'item.action.add', label: 'Add connected node', group: 'editing', hidden: true },
    ]);

    on('item.action.hold.start', ({ ref, x, y, pointerId }) => {
      cancelHold();
      contexts.places.el(Places.Stage)?.classList.add('holding-action');
      const timer = setTimeout(() => emit('item.action.open', { ref, x, y }), HOLD_MS);
      hold = { ref, start: { x, y }, pointerId, timer };
    });
    on('item.action.hold.move', ({ x, y, pointerId }) => {
      if (!hold || hold.pointerId !== pointerId) return;
      if (Math.hypot(x - hold.start.x, y - hold.start.y) > HOLD_SLOP) cancelHold();
    });
    on('item.action.hold.end', ({ pointerId }) => {
      if (hold?.pointerId === pointerId) cancelHold();
    });
    on('item.action.open', openWheel);
    on('item.action.close', closeWheel);
    on('item.action.run', ({ command }) => {
      if (!command) return closeWheel();
      const target = contexts.places.el(Places.Stage)?.querySelector<HTMLElement>('.item-action-wheel') ?? undefined;
      contexts.commands.run(command, { target, origin: 'pointer' });
      closeWheel();
    });
    on('item.action.add', () => {
      contexts.commands.run('editing.node.create', {
        origin: selection.selectedNode() ? 'programmatic' : 'pointer',
      });
    });
    on('modal.open', closeWheel);
    on('commandPicker.open', closeWheel);
    on('graph.switched', closeWheel);
    // Camera settling may emit view.changed while a finger is still down.
    // Preserve that pending hold; only an already-open wheel follows camera moves.
    on('view.changed', () => {
      if (wheelOpen) closeWheel();
    });
    on('view.pan.start', closeWheel);

    const draw = () => {
      if (selection.selectedAll().length !== 1) return clearToolbar();
      const ref = selection.selected();
      if (!ref) return clearToolbar();
      const entityDef = model.entity(ref.kind);
      const item = graphs.current.getItem(ref);
      if (!entityDef || !item) return clearToolbar();
      const bounds = entityDef.render?.bounds?.(item as never);
      if (bounds && !contexts.view.isVisible(Places.Stage, bounds, 80)) return clearToolbar();
      const affs = contexts.affordances.entity(entityDef).filter(({ ui }) => !ui.when || ui.when(item));
      if (!affs.length) return clearToolbar();
      emit('render.view.set', {
        place: Places.Stage,
        key: 'item-toolbar',
        view: () => buildToolbar(entityDef, item, ref),
      });
    };

    on('render.stage.draw', draw);
    on('render.stage.camera', draw);
    const offCancel = contexts.cancellation.register({
      origin,
      priority: 20,
      active: () => wheelOpen || !!hold,
      cancel: closeWheel,
    });
    return () => {
      offCancel();
      cancelHold();
      clearWheel();
    };
  }, { requires: ['render.stage', 'graph'] });
}
