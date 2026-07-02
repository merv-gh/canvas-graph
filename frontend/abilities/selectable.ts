import { foldHidden, isStageSurface, itemIdFrom, itemRefFrom, nodeRef, type Registry } from '../core';
import type { CommandSource, Id, ItemRef } from '../types';
import { ability, action } from './shared';
import type { Identified } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'selection.item.select': ItemRef;
    'selection.item.toggle': ItemRef;
    /** The choosing seam: build the set by replacing / adding / removing /
     *  toggling. Single-select is `{ refs: [ref], mode: 'replace' }`. */
    'selection.choose': { refs: ItemRef[]; mode: 'replace' | 'add' | 'remove' | 'toggle' };
    'selection.item.clear': void;
    'selection.item.delete': void;
    'selection.item.selected': ItemRef | null;
    /** Fact carrying the whole chosen set after any change (the store emits it). */
    'selection.changed': { refs: ItemRef[] };
    'selection.node.select': { id: Id };
    'selection.node.clear': void;
    'selection.node.selected': { id: Id | null };
  }
}

/** Selectable — every entity that has an id can have this. The pointerdown
 *  handler is registered globally (looks for [data-item-kind][data-item-id]) so
 *  no template slot is required; declaring the ability is enough.
 *  Keyboard reachability: the entity-surface UI handler is the affordance; no
 *  paletteCommand because there's no concept of "select THIS item via keyboard"
 *  outside of Tab cycling (which lives as its own standalone command). */
export const selectable = <T extends Identified>() => ability<T>('selectable', [action<T>({
  id: 'item.select',
  label: 'Select item',
  ui: [{ surface: 'entity', command: 'selection.item.select', kind: 'handler' }],
})]);

export function registerSelectable(system: Registry) {
  system('ability.selectable', ({ on, emit, contexts, graphs, selection, origin }) => {
    const selectedNodeId = () => selection.selectedNode()?.id ?? null;
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || selectedNodeId() || '';
    // Tab cycles only *visible* nodes — never a node hidden inside a collapsed
    // container (which would leave a floating toolbar over nothing).
    const visibleNodes = () => graphs.current.nodes()
      .filter(node => !foldHidden(nodeRef(node.id), contexts.hierarchy.parentChain, contexts.fold, graphs.current.id));
    const nextNodeId = () => {
      const nodes = visibleNodes();
      const index = Math.max(0, nodes.findIndex(node => node.id === selectedNodeId()));
      return nodes[(index + 1) % nodes.length]?.id ?? nodes[0]?.id ?? '';
    };
    const previousNodeId = () => {
      const nodes = visibleNodes();
      const index = nodes.findIndex(node => node.id === selectedNodeId());
      return nodes[(index <= 0 ? nodes.length : index) - 1]?.id ?? nodes[0]?.id ?? '';
    };

    contexts.commands.register([
      {
        id: 'selection.item.select',
        label: 'Select item',
        group: 'selection',
        hidden: true,
        input: {
          on: 'pointerdown',
          selector: '[data-item-kind][data-item-id]',
          // `.modal-layer`, inputs, and labels are excluded so a click on a
          // property field (the `.properties` form carries data-item-kind/id)
          // focuses the input instead of being eaten by select's preventDefault.
          when: event => !(event.target as Element).closest('[data-command], [data-drag-handle], [data-resize-handle], [data-container-section-title], [data-container-section-resize], .modal-layer, input, textarea, select, label'),
          prevent: true,
          stop: true,
        },
        payload: source => itemRefFrom(source.target) ?? nodeRef(nodeId(source)),
      },
      {
        // Shift+pointer toggles an item in/out of the set — random-access
        // include/exclude. Plain pointerdown (no shift) hits the command above;
        // this one requires shift, so they never collide.
        id: 'selection.item.toggle',
        label: 'Toggle item in selection',
        group: 'selection',
        hidden: true,
        input: {
          on: 'pointerdown',
          selector: '[data-item-kind][data-item-id]',
          shift: true,
          // `.modal-layer`, inputs, and labels are excluded so a click on a
          // property field (the `.properties` form carries data-item-kind/id)
          // focuses the input instead of being eaten by select's preventDefault.
          when: event => !(event.target as Element).closest('[data-command], [data-drag-handle], [data-resize-handle], [data-container-section-title], [data-container-section-resize], .modal-layer, input, textarea, select, label'),
          prevent: true,
          stop: true,
        },
        payload: source => itemRefFrom(source.target) ?? nodeRef(nodeId(source)),
      },
      {
        id: 'selection.node.select',
        label: 'Select node',
        group: 'selection',
        hidden: true,
        payload: source => ({ id: nodeId(source) }),
      },
      {
        id: 'selection.node.next',
        label: 'Select next node',
        event: 'selection.node.select',
        group: 'selection',
        shortcut: 'Tab',
        input: { on: 'keydown', key: 'Tab', prevent: true },
        available: () => graphs.current.nodes().length > 0,
        payload: () => ({ id: nextNodeId() }),
      },
      {
        id: 'selection.node.previous',
        label: 'Select previous node',
        event: 'selection.node.select',
        group: 'selection',
        shortcut: 'Shift+Tab',
        input: { on: 'keydown', key: 'Tab', shift: true, prevent: true },
        available: () => graphs.current.nodes().length > 0,
        payload: () => ({ id: previousNodeId() }),
      },
      {
        id: 'selection.node.clear',
        label: 'Clear selection',
        group: 'selection',
        available: () => !!selection.selected(),
      },
      {
        id: 'selection.item.delete',
        label: 'Delete selection',
        group: 'selection',
        shortcut: 'X',
        input: { on: 'keydown', key: 'x', prevent: true },
        // Any selection is potentially deletable. Each kind's owner handles its
        // own delete listener; the command stays open so containers / future
        // kinds can hook in without selectable knowing the kind exists.
        available: () => !!selection.selected(),
      },
    ]);

    on('selection.node.select', ({ id }) => emit('selection.item.select', nodeRef(id)));
    on('selection.node.clear', () => emit('selection.item.clear'));
    // Entry points just drive the store; the store commits `selection.changed`,
    // and the single handler below turns that one fact into decorations + focus.
    on('selection.item.select', ref => selection.select(ref));
    on('selection.item.toggle', ref => selection.toggle(ref));
    on('selection.item.clear', () => selection.select(null));
    on('selection.choose', ({ refs, mode }) => {
      if (mode === 'add') refs.forEach(ref => selection.add(ref));
      else if (mode === 'remove') refs.forEach(ref => selection.remove(ref));
      else if (mode === 'toggle') refs.forEach(ref => selection.toggle(ref));
      else selection.choose(refs);
    });
    // One reaction to any set change: paint the WHOLE set 'selected', move focus
    // to the primary. Deletion cleanup flows through here too (store re-commits).
    on('selection.changed', ({ refs }) => {
      if (refs.length) contexts.decorations.modes.set(origin, 'selected', refs);
      else contexts.decorations.unregisterOrigin(origin);
      const primary = refs[refs.length - 1] ?? null;
      if (primary) emit('focus.item.focus', primary);
      else emit('focus.item.clear');
    });
    on('selection.item.delete', () => {
      // Fan out over the chosen set — each kind owner deletes its own items
      // (containers handles 'container'). Same command for 1 or N.
      const refs = selection.selectedAll();
      selection.select(null);
      refs.forEach(ref => {
        if (ref.kind === 'node') emit('graph.node.delete', { id: ref.id });
        if (ref.kind === 'edge') emit('graph.edge.delete', { id: ref.id });
      });
    });
    contexts.cancellation.register({
      origin,
      priority: -10,
      active: () => selection.selectedAll().length > 0,
      cancel: () => emit('selection.item.clear'),
    });
  });
}
