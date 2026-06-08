import { uiValue, type Registry } from '../core';
import { Places } from '../types';
import type { ActionDef, AffordanceDef } from '../types';
import type { GraphNode } from '../model';

/** Ephemeral toolbar pinned above the selected node. Replaces the in-node
 *  header so the node template stays one title + one body — layouts inside
 *  the node never fight with chrome.
 *
 *  Pulls every ability affordance from the same `affordances.entity(...)` API
 *  render-stage already uses, so collapsible/configurable/draggable need no
 *  changes when the chrome moves. New abilities show up here automatically as
 *  long as they declare `slot: 'drag' | 'header:start' | 'header:end'`. */
export function registerNodeToolbar(system: Registry) {
  system('node.toolbar', ({ on, emit, contexts, graphs, model, selection }) => {
    const clear = () => emit('render.view.clear', { place: Places.Stage, key: 'node-toolbar' });

    const buildButton = (node: GraphNode, action: ActionDef<GraphNode>, ui: AffordanceDef<GraphNode>) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = ui.command;
      button.textContent = uiValue(ui.text, node, action.label);
      button.setAttribute('aria-label', uiValue(ui.label, node, action.label));
      if (ui.className) button.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => button.setAttribute(name, uiValue(value, node)));
      return button;
    };

    const buildHandler = (node: GraphNode, ui: AffordanceDef<GraphNode>, text: string) => {
      const span = document.createElement('span');
      if (ui.className) span.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => span.setAttribute(name, uiValue(value, node)));
      span.textContent = text;
      return span;
    };

    const buildToolbar = (node: GraphNode) => {
      const entityDef = model.entity<GraphNode>('node');
      if (!entityDef) return null;
      const wrapper = document.createElement('div');
      wrapper.className = 'node-toolbar';
      // data-item-* lets the drag command's `itemIdFrom(target)` resolve the
      // node id from inside the toolbar without us threading the id manually.
      wrapper.dataset.itemKind = 'node';
      wrapper.dataset.itemId = node.id;
      const screen = contexts.view.spaceToScreen({
        x: node.Position?.x ?? 0,
        y: (node.Position?.y ?? 0) - node.Size.h / 2,
      });
      wrapper.style.left = `${screen.x}px`;
      wrapper.style.top = `${screen.y}px`;

      const append = (slot: string, kind: 'button' | 'handler', handlerText = '', baseClass = '') => {
        contexts.affordances.entity(entityDef, slot).forEach(({ action, ui }) => {
          if (ui.kind !== kind) return;
          const el = kind === 'button'
            ? buildButton(node, action as ActionDef<GraphNode>, ui as AffordanceDef<GraphNode>)
            : buildHandler(node, ui as AffordanceDef<GraphNode>, handlerText);
          if (baseClass) el.classList.add(baseClass);
          wrapper.append(el);
        });
      };
      append('drag', 'handler', '⋮⋮', 'node-drag-handle');
      append('header:start', 'button');
      append('header:end', 'button');
      return wrapper;
    };

    const draw = () => {
      const ref = selection.selected();
      if (ref?.kind !== 'node') return clear();
      const node = graphs.current.getNode(ref.id) as GraphNode | undefined;
      if (!node) return clear();
      emit('render.view.set', {
        place: Places.Stage,
        key: 'node-toolbar',
        view: () => buildToolbar(node) ?? '',
      });
    };

    // Render piggybacks on the stage scheduler — one draw per RAF, no own coalescing.
    on('render.stage.draw', draw);
  });
}
