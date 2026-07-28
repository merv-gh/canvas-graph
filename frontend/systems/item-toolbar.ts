import { itemRefFrom, type Registry } from '../core';
import { Places } from '../types';
import type { ItemRef, Position } from '../types';
import { createItemToolbarView, type OpenActionMenu } from './item-toolbar-view';

declare module '../types' {
  interface CustomEvents {
    'item.action.hold.start': { ref: ItemRef; x: number; y: number; pointerId: number };
    'item.action.hold.move': { x: number; y: number; pointerId: number };
    'item.action.hold.end': { pointerId: number };
    'item.action.open': { ref: ItemRef; x?: number; y?: number };
    'item.action.close': void;
    'item.action.run': { command: string };
    'item.action.navigate': { key: string };
    'item.action.add': void;
    'item.action.style.toggle': void;
    'item.action.outside.pointer': void;
    'canvas.action.open': { x: number; y: number };
  }
}
const HOLD_MS = 460;
const HOLD_SLOP = 12;

/** Selected-item toolbar for pointer desktops plus a Krita-style radial action
 * wheel for compact/touch work. Both surfaces reuse canonical commands; the
 * wheel only changes disclosure and target acquisition. */
export function registerItemToolbar(system: Registry) {
  system('item.toolbar', ({ on, emit, contexts, graphs, model, selection, origin, frameLoop }) => {
    let hold: { ref: ItemRef; start: Position; pointerId: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let openMenu: OpenActionMenu | null = null;
    let restoreFocus: HTMLElement | null = null;
    let itemMenuStyle: 'radial' | 'list' = 'radial';
    const clearToolbar = () => emit('render.view.clear', { place: Places.Stage, key: 'item-toolbar' });
    const clearWheel = () => emit('render.view.clear', { place: Places.Stage, key: 'item-action-wheel' });
    const sameRef = (a: ItemRef | null, b: ItemRef) => !!a && a.kind === b.kind && a.id === b.id;

    const cancelHold = () => {
      if (!hold) return;
      clearTimeout(hold.timer);
      hold = null;
      contexts.places.el(Places.Stage)?.classList.remove('holding-action');
    };
    const closeWheel = (shouldRestoreFocus = true) => {
      cancelHold();
      contexts.places.el(Places.Stage)?.classList.remove('context-menu-open');
      if (!openMenu) return;
      openMenu = null;
      clearWheel();
      const target = shouldRestoreFocus ? restoreFocus : null;
      restoreFocus = null;
      if (!target) return;
      frameLoop.schedule('item.action.restoreFocus.prepare', () => {
        frameLoop.schedule('item.action.restoreFocus.commit', () => {
          if (target?.isConnected) target.focus({ preventScroll: true });
        }, 40);
      }, 40);
    };

    const view = () => createItemToolbarView({
      contexts,
      graphs,
      itemMenuStyle,
      model,
      openMenu,
      selection,
    });

    const redrawOpenMenu = () => {
      if (!openMenu) return;
      emit('render.view.set', {
        place: Places.Stage,
        key: 'item-action-wheel',
        view: () => view().renderOpenMenu(),
      });
      frameLoop.schedule('item.action.focus.prepare', () => {
        frameLoop.schedule('item.action.focus.commit', () => {
          const menu = contexts.places.el(Places.Stage)?.querySelector<HTMLElement>('.item-action-wheel, .context-command-menu');
          const first = menu?.querySelector<HTMLElement>('[role="menuitem"]');
          if (!first) return;
          first.tabIndex = 0;
          first.focus({ preventScroll: true });
        }, 45);
      }, 45);
    };

    const openWheel = ({ ref, x, y }: { ref: ItemRef; x?: number; y?: number }) => {
      cancelHold();
      if (!graphs.current.getItem(ref)) return;
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!sameRef(selection.selected(), ref)) emit('selection.item.select', ref);
      openMenu = { kind: 'item', ref, x, y };
      contexts.places.el(Places.Stage)?.classList.add('context-menu-open');
      redrawOpenMenu();
    };

    const openCanvasMenu = ({ x, y }: { x: number; y: number }) => {
      cancelHold();
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openMenu = { kind: 'canvas', x, y };
      contexts.places.el(Places.Stage)?.classList.add('context-menu-open');
      redrawOpenMenu();
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
              && !(event.target as Element).closest('.tool-panel, .item-toolbar, .modal-layer, [data-command], [data-resize-handle], input, textarea, select');
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
        input: {
          on: 'contextmenu', selector: '[data-item-kind][data-item-id]', prevent: true, stop: true,
          when: ({ target }) => !(target as Element | null)?.closest('.tool-panel, .item-toolbar, .modal-layer'),
        },
        payload: ({ event, target }) => {
          const ref = itemRefFrom(target);
          const pointer = event as MouseEvent;
          return ref ? { ref, x: pointer.clientX, y: pointer.clientY } : undefined;
        },
      },
      {
        id: 'canvas.action.context', label: 'Open canvas actions', event: 'canvas.action.open', group: 'view', hidden: true,
        input: {
          on: 'contextmenu', selector: '[data-place="stage"]', prevent: true, stop: true,
          when: ({ target }) => !(target as Element | null)?.closest('[data-item-kind][data-item-id], .tool-panel, .item-toolbar, .context-command-menu, .modal-layer'),
        },
        payload: ({ event }) => ({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY }),
      },
      ...(['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'] as const).map(key => ({
        id: `item.action.navigate.${key.toLocaleLowerCase()}`,
        label: `Navigate item actions (${key})`,
        event: 'item.action.navigate' as const,
        group: 'item',
        hidden: true,
        input: {
          on: 'keydown' as const,
          key,
          global: true,
          prevent: true,
          stop: true,
          when: (_event: Event, target: Element) => !!openMenu && !!target.closest('.item-action-wheel, .context-command-menu'),
        },
        payload: () => ({ key }),
      })),
      {
        id: 'item.action.activate', label: 'Activate focused item action', event: 'item.action.run', group: 'item', hidden: true,
        input: {
          on: 'keydown', key: 'Enter', selector: '[role="menuitem"][data-action-command]',
          prevent: true, stop: true,
        },
        payload: ({ target }) => ({ command: target?.closest<HTMLElement>('[data-action-command]')?.dataset.actionCommand ?? '' }),
      },
      { id: 'item.action.close', label: 'Close item actions', group: 'item', hidden: true },
      {
        id: 'item.action.outside.pointer', label: 'Close item actions on outside click', group: 'item', hidden: true,
        input: {
          on: 'pointerdown', global: true,
          when: event => !!openMenu
            && (event as PointerEvent).button === 0
            && !(event.target as Element | null)?.closest('.item-action-wheel, .context-command-menu'),
        },
      },
      { id: 'item.action.style.toggle', label: 'Toggle item context menu style', group: 'item', hidden: true },
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
    on('canvas.action.open', openCanvasMenu);
    on('item.action.close', () => closeWheel());
    on('item.action.outside.pointer', () => closeWheel());
    on('item.action.navigate', ({ key }) => {
      const menu = contexts.places.el(Places.Stage)?.querySelector<HTMLElement>('.item-action-wheel, .context-command-menu');
      const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
      const next = key === 'Home' ? 0
        : key === 'End' ? items.length - 1
          : (current + (key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
      items.forEach((item, index) => { item.tabIndex = index === next ? 0 : -1; });
      items[next]?.focus({ preventScroll: true });
    });
    on('item.action.style.toggle', () => {
      if (openMenu?.kind !== 'item') return;
      itemMenuStyle = itemMenuStyle === 'radial' ? 'list' : 'radial';
      redrawOpenMenu();
    });
    on('item.action.run', ({ command }) => {
      if (!command) return closeWheel();
      const target = contexts.places.el(Places.Stage)?.querySelector<HTMLElement>('.item-action-wheel, .context-command-menu') ?? undefined;
      contexts.commands.run(command, { target, origin: 'pointer' });
      // The invoked command may move focus into an editor or picker. Do not
      // overwrite that command-owned focus with the menu's restore target.
      closeWheel(false);
    });
    on('item.action.add', () => {
      contexts.commands.run('editing.node.create', {
        origin: selection.selectedNode() ? 'programmatic' : 'pointer',
      });
    });
    on('modal.open', () => closeWheel());
    on('commandPicker.open', () => closeWheel());
    on('graph.switched', () => closeWheel());
    // Camera settling may emit view.changed while a finger is still down.
    // Preserve that pending hold; only an already-open wheel follows camera moves.
    on('view.changed', () => {
      if (openMenu) closeWheel();
    });
    on('view.pan.start', () => closeWheel());

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
        view: () => view().buildToolbar(entityDef, item, ref),
      });
    };

    on('render.stage.draw', draw);
    on('render.stage.camera', draw);
    const offCancel = contexts.interaction.cancel.register({
      origin,
      priority: 20,
      active: () => !!openMenu || !!hold,
      cancel: closeWheel,
    });
    return () => {
      offCancel();
      cancelHold();
      clearWheel();
    };
  }, { requires: ['render.stage', 'graph'] });
}
