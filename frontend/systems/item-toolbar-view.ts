import {
  clamp,
  commandShortcut,
  iconNode,
  itemFoldId,
  setIcon,
  tagItem,
  uiValue,
  type AppCtx,
} from '../core';
import { Places, Slots } from '../types';
import type { ActionDef, AffordanceDef, EntityDef, IconName, ItemRef, Position } from '../types';

type WheelAction = {
  command: string;
  glyph: string;
  icon: IconName;
  label: string;
  section: 'Mode' | 'Edit' | 'State' | 'Structure' | 'Danger';
  danger?: boolean;
  active?: boolean;
};

export type OpenActionMenu =
  | { kind: 'item'; ref: ItemRef; x?: number; y?: number }
  | { kind: 'canvas'; x: number; y: number };

type ItemToolbarViewDependencies = {
  contexts: AppCtx['contexts'];
  graphs: AppCtx['graphs'];
  itemMenuStyle: 'radial' | 'list';
  model: AppCtx['model'];
  openMenu: OpenActionMenu | null;
  selection: AppCtx['selection'];
};

export const createItemToolbarView = ({
  contexts,
  graphs,
  itemMenuStyle,
  model,
  openMenu,
  selection,
}: ItemToolbarViewDependencies) => {
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
      let screen = contexts.view.spaceToScreen({ x: rect.x + rect.w / 2, y: rect.y });
      const stage = contexts.places.el(Places.Stage);
      const stageRect = stage?.getBoundingClientRect();
      const stageWidth = stageRect?.width || window.innerWidth;
      const leftPanel = contexts.places.el(Places.Left)?.getBoundingClientRect();
      const minX = leftPanel && leftPanel.width > 0 ? leftPanel.right + 44 : 0;
      if (ref.kind === 'edge') {
        const label = stage?.querySelector<SVGGraphicsElement>(`.edge-label-host[data-item-id="${ref.id}"]`);
        const labelRect = label?.getBoundingClientRect();
        if (labelRect && stageRect) {
          const toolbarWidth = 112;
          const toolbarHeight = 36;
          const gap = 8;
          const roomRight = stageRect.right - labelRect.right;
          const leftAnchor = labelRect.left - stageRect.left - gap;
          const roomAbove = labelRect.top - stageRect.top;
          const centerY = labelRect.top - stageRect.top + labelRect.height / 2;
          if (stageWidth > 680 && roomRight >= toolbarWidth + gap) {
            wrapper.dataset.edgeToolbarPlacement = 'right';
            screen = { x: labelRect.right - stageRect.left + gap, y: centerY };
          } else if (stageWidth > 680 && leftAnchor - toolbarWidth >= minX) {
            wrapper.dataset.edgeToolbarPlacement = 'left';
            screen = { x: leftAnchor, y: centerY };
          } else if (roomAbove >= toolbarHeight + gap) {
            wrapper.dataset.edgeToolbarPlacement = 'above';
            screen = {
              x: labelRect.left - stageRect.left + labelRect.width / 2,
              y: labelRect.top - stageRect.top,
            };
          } else {
            wrapper.dataset.edgeToolbarPlacement = 'below';
            screen = {
              x: labelRect.left - stageRect.left + labelRect.width / 2,
              y: labelRect.bottom - stageRect.top,
            };
          }
        }
      }
      wrapper.style.left = `${Math.max(screen.x, minX)}px`;
      wrapper.style.top = `${Math.max(screen.y, stageWidth <= 680 ? 104 : 88)}px`;

      const append = (slot: string) => {
        contexts.affordances.entity(entityDef, slot).forEach(({ action, ui }) => {
          if (ui.when && !ui.when(item)) return;
          if (ui.kind === 'button') wrapper.append(buildButton(item, action, ui, ref));
        });
      };
      append(Slots.HeaderStart);
      append(Slots.HeaderEnd);
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
      const canMoveInto = ref.kind !== 'edge' && (
        !!contexts.hierarchy.parentRefOf(ref)
        || graphs.current.itemsOfKind('container').some(container => (container as { id: string }).id !== ref.id)
      );
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
        { command: 'canvas.select', glyph: '↖', icon: 'select', label: 'Select mode', section: 'Mode', active: !contexts.interaction.cancel.blocksPointer() },
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
    return { buildToolbar, renderOpenMenu };
};

