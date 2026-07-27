import { clamp, commandShortcut, iconNode, itemFoldId, itemRefFrom, setIcon, tagItem, uiValue, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { ActionDef, AffordanceDef, EntityDef, IconName, ItemRef, Position } from '../types';

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

type WheelAction = {
  command: string;
  glyph: string;
  icon: IconName;
  label: string;
  section: 'Mode' | 'Edit' | 'State' | 'Structure' | 'Danger';
  danger?: boolean;
  active?: boolean;
};

type OpenActionMenu =
  | { kind: 'item'; ref: ItemRef; x?: number; y?: number }
  | { kind: 'canvas'; x: number; y: number };

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
      if (ref.kind === 'node' || ref.kind === 'container') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'node-action node-remove';
        remove.dataset.command = ref.kind === 'node' ? 'graph.node.delete' : 'graph.container.delete';
        remove.setAttribute('aria-label', `Delete ${ref.kind}`);
        remove.title = `Delete ${ref.kind}`;
        setIcon(remove, 'trash');
        wrapper.append(remove);
      }
      return wrapper;
    };

    const wheelActions = (ref: ItemRef, root: HTMLElement): WheelAction[] => {
      const canMoveInto = ref.kind !== 'edge'
        && graphs.current.itemsOfKind('container').some(container => (container as { id: string }).id !== ref.id);
      const common: WheelAction[] = [
        { command: 'item.title.edit', glyph: 'Aa', icon: 'text', label: 'Rename', section: 'Edit' },
        { command: 'item.description.edit', glyph: '¶', icon: 'text', label: 'Edit description', section: 'Edit' },
        { command: 'item.properties.open', glyph: '⋯', icon: 'more', label: 'Details', section: 'Edit' },
        ...(canMoveInto ? [{ command: 'container.add-child', glyph: '↳', icon: 'move-out' as const, label: 'Move into', section: 'Structure' as const }] : []),
      ];
      const contextual = ref.kind === 'node'
        ? [
            ...(graphs.current.getNode(ref.id)?.NodeType === 'toggle'
              ? [{ command: 'node.toggle.state', glyph: '◉', icon: 'toggle' as const, label: graphs.current.getNode(ref.id)?.ToggleState ? 'Turn off' : 'Turn on', section: 'State' as const }]
              : []),
            { command: 'item.action.add', glyph: '+', icon: 'node' as const, label: 'Add connected', section: 'Structure' as const },
            { command: 'editing.edge.create', glyph: '↗', icon: 'connect' as const, label: 'Connect', section: 'Structure' as const },
            { command: 'node.convert.container', glyph: '▣', icon: 'container' as const, label: 'To container', section: 'Structure' as const },
            { command: 'item.collapse.toggle', glyph: '−', icon: 'collapse' as const, label: 'Fold', section: 'Structure' as const },
          ]
        : ref.kind === 'edge'
          ? [{ command: 'graph.edge.reverse', glyph: '⇄', icon: 'reverse' as const, label: 'Reverse', section: 'Structure' as const }]
          : [
              { command: 'editing.node.create', glyph: '+', icon: 'node' as const, label: 'Add node', section: 'Structure' as const },
              { command: 'container.convert.node', glyph: '□', icon: 'node' as const, label: 'To node', section: 'Structure' as const },
              { command: 'item.collapse.toggle', glyph: '−', icon: 'collapse' as const, label: 'Fold', section: 'Structure' as const },
            ];
      const actions: WheelAction[] = [
        ...common,
        ...contextual,
        { command: 'selection.item.delete', glyph: '×', icon: 'trash', label: 'Delete', section: 'Danger', danger: true },
      ];
      return actions.filter(action => {
        if (action.command === 'editing.edge.create' && graphs.current.nodes().length < 2) return false;
        const command = contexts.commands.get(action.command);
        return !!command && contexts.commands.isEnabled(command)
          && command.available?.({ target: root, origin: 'pointer' }) !== false;
      });
    };

    const actionMenuAnchor = (x: number, y: number, menuWidth = 236, menuHeight = 420) => {
      const stage = contexts.places.el(Places.Stage);
      const rect = stage?.getBoundingClientRect();
      const width = rect?.width || window.innerWidth;
      const height = rect?.height || window.innerHeight;
      return {
        x: clamp(x - (rect?.left ?? 0), 8, Math.max(8, width - menuWidth - 8)),
        y: clamp(y - (rect?.top ?? 0), 8, Math.max(8, height - Math.min(menuHeight, height - 16) - 8)),
      };
    };

    const actionMenuButton = (action: WheelAction) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `context-command-item${action.danger ? ' danger' : ''}`;
      button.dataset.command = 'item.action.run';
      button.dataset.actionCommand = action.command;
      button.dataset.interactionCost = action.command === 'editing.edge.create' || action.command === 'container.add-child' ? '3' : '2';
      button.setAttribute('role', 'menuitem');
      button.tabIndex = -1;
      button.setAttribute('aria-label', action.label);
      if (action.active !== undefined) {
        button.dataset.active = action.active ? 'true' : 'false';
        if (action.active) button.setAttribute('aria-current', 'true');
      }
      const icon = document.createElement('span');
      icon.className = 'context-command-icon';
      icon.append(iconNode(action.icon));
      const label = document.createElement('span');
      label.className = 'context-command-label';
      label.textContent = action.label;
      const shortcut = document.createElement('kbd');
      shortcut.textContent = commandShortcut(contexts.commands, action.command) ?? '';
      button.append(icon, label, shortcut);
      return button;
    };

    const renderActionList = (actions: WheelAction[], label: string, x: number, y: number, ref?: ItemRef) => {
      const root = document.createElement('div');
      root.className = ref ? 'item-action-menu context-command-menu' : 'canvas-action-menu context-command-menu';
      root.setAttribute('role', 'menu');
      root.setAttribute('aria-label', label);
      if (ref) tagItem(root, ref);
      const anchor = actionMenuAnchor(x, y, ref ? 236 : 252, ref ? 420 : 390);
      root.style.left = `${anchor.x}px`;
      root.style.top = `${anchor.y}px`;
      const grouped = new Map<string, WheelAction[]>();
      actions.forEach(action => (grouped.get(action.section) ?? grouped.set(action.section, []).get(action.section)!).push(action));
      grouped.forEach((sectionActions, section) => {
        const group = document.createElement('section');
        group.className = `context-command-group${section === 'Danger' ? ' danger' : ''}`;
        const heading = document.createElement('h3');
        heading.textContent = section;
        group.append(heading, ...sectionActions.map(actionMenuButton));
        root.append(group);
      });
      return root;
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
        y: height < 304 ? height / 2 : clamp(raw.y, 138, height - 154),
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
        button.tabIndex = -1;
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
      const style = document.createElement('button');
      style.type = 'button';
      style.className = 'item-action-style-toggle';
      style.dataset.command = 'item.action.style.toggle';
      style.textContent = 'List view';
      style.setAttribute('aria-label', 'Use list context menu');
      root.append(center, style);
      return root;
    };

    const renderItemList = (ref: ItemRef, x?: number, y?: number) => {
      const item = graphs.current.getItem(ref);
      const entityDef = model.entity(ref.kind);
      if (!item || !entityDef) return document.createDocumentFragment();
      const fallback = contexts.hierarchy.anchor(ref);
      const screen = fallback ? contexts.view.spaceToScreen(fallback) : contexts.view.screenCenter(Places.Stage);
      const availabilityTarget = document.createElement('div');
      tagItem(availabilityTarget, ref);
      const root = renderActionList(wheelActions(ref, availabilityTarget), `${entityDef.labelOf(item)} actions`, x ?? screen.x, y ?? screen.y, ref);
      const footer = document.createElement('footer');
      const style = document.createElement('button');
      style.type = 'button';
      style.className = 'context-command-style-toggle';
      style.dataset.command = 'item.action.style.toggle';
      style.textContent = 'Use radial menu';
      style.setAttribute('aria-label', 'Use radial context menu');
      footer.append(style);
      root.append(footer);
      return root;
    };

    const canvasActions = (): WheelAction[] => {
      const stage = contexts.places.el(Places.Stage);
      const actions: WheelAction[] = [
        { command: 'palette.place.activate', glyph: '+', icon: 'node', label: 'Add node', section: 'Mode', active: !!stage?.classList.contains('node-placing') },
        { command: 'ink.toggle', glyph: '✎', icon: 'draw', label: 'Draw mode', section: 'Mode', active: !!stage?.classList.contains('ink-drawing') },
        { command: 'canvas.select', glyph: '↖', icon: 'select', label: 'Select mode', section: 'Mode', active: !contexts.cancellation.blocksPointer() },
        { command: 'ink.erase.toggle', glyph: '⌫', icon: 'erase', label: 'Erase canvas items', section: 'Mode', active: !!stage?.classList.contains('ink-erasing') },
        { command: 'editing.edge.create', glyph: '↗', icon: 'connect', label: 'Connect nodes', section: 'Structure' },
        { command: 'selection.group', glyph: '▣', icon: 'group', label: selection.selectedAll().length ? 'Group selected' : 'Create container', section: 'Structure' },
        { command: 'history.undo', glyph: '↶', icon: 'undo', label: 'Undo', section: 'Edit' },
        { command: 'history.redo', glyph: '↷', icon: 'redo', label: 'Redo', section: 'Edit' },
        { command: 'view.fit.all', glyph: '⌗', icon: 'fit', label: 'Fit canvas', section: 'Edit' },
        { command: 'palette.open', glyph: '⌘', icon: 'commands', label: 'Commands…', section: 'Edit' },
      ];
      return actions.filter(action => {
        const command = contexts.commands.get(action.command);
        return !!command && contexts.commands.isEnabled(command)
          && command.available?.({ target: stage ?? undefined, origin: 'pointer' }) !== false;
      });
    };

    const renderOpenMenu = () => {
      if (!openMenu) return document.createDocumentFragment();
      if (openMenu.kind === 'canvas') return renderActionList(canvasActions(), 'Canvas actions', openMenu.x, openMenu.y);
      return itemMenuStyle === 'radial'
        ? renderWheel(openMenu.ref, openMenu.x, openMenu.y)
        : renderItemList(openMenu.ref, openMenu.x, openMenu.y);
    };

    const redrawOpenMenu = () => {
      if (!openMenu) return;
      emit('render.view.set', {
        place: Places.Stage,
        key: 'item-action-wheel',
        view: renderOpenMenu,
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
              && !(event.target as Element).closest('.tool-panel, .item-toolbar, .modal-layer, [data-command], [data-drag-handle], [data-resize-handle], input, textarea, select');
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
        view: () => buildToolbar(entityDef, item, ref),
      });
    };

    on('render.stage.draw', draw);
    on('render.stage.camera', draw);
    const offCancel = contexts.cancellation.register({
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
