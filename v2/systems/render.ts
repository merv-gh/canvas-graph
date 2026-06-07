import type { GraphNode } from '../model';
import {
  appendRenderable,
  commandShortcut,
  edgeRef,
  emptyState,
  entityUi,
  factScope,
  nodeRef,
  nodeRect,
  uiValue,
  type Registry,
} from '../core';
import { Places } from '../types';
import type { ActionDef, AffordanceDef, ItemRef, Place, RedrawScope, Renderable } from '../types';

export function registerRender(system: Registry) {
  system('render', ctx => {
    const { on, emit, bus, graphs, contexts, model } = ctx;
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
      (['header', 'title', 'drag'] as const).forEach(slot => entityUi(entityDef, slot)
        .filter(({ ui }) => ui.kind === 'handler')
        .forEach(({ ui }) => applyAffordance(contexts.templates.slot(el, slot), node, ui)));
      (['header:start', 'header:end'] as const).forEach(slot => {
        const target = contexts.templates.slot(el, slot);
        entityUi(entityDef, slot)
          .filter(({ ui }) => ui.kind === 'button')
          .forEach(({ action, ui }) => target.append(affordanceButton(node, action, ui)));
      });
    };
    const tagItem = (el: HTMLElement | SVGElement, ref: ItemRef) => {
      el.setAttribute('data-item-kind', ref.kind);
      el.setAttribute('data-item-id', ref.id);
    };
    const applyItemModes = (el: HTMLElement | SVGElement, ref: ItemRef) => {
      const classes = [...new Set(contexts.itemModes.for(ref).map(mode => mode.className ?? mode.mode).filter(Boolean))];
      if (!classes.length) return;
      el.classList.add(...classes);
      el.setAttribute('data-item-modes', classes.join(' '));
    };
    const itemSelector = (ref: ItemRef) =>
      `[data-item-kind="${ref.kind}"][data-item-id="${ref.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    const drawOverlays = (layer: HTMLElement) => {
      const overlayLayer = document.createElement('div');
      overlayLayer.className = 'item-overlays';
      contexts.itemOverlays.all().forEach(overlay => {
        const anchor = contexts.itemTargets.anchor(overlay.ref);
        if (!anchor) return;
        const el = document.createElement('div');
        el.className = 'item-overlay';
        if (overlay.className) el.classList.add(...overlay.className.split(/\s+/).filter(Boolean));
        tagItem(el, overlay.ref);
        if (overlay.id) el.dataset.overlayId = overlay.id;
        el.textContent = overlay.text;
        el.style.left = `${anchor.x}px`;
        el.style.top = `${anchor.y}px`;
        overlayLayer.append(el);
      });
      layer.append(overlayLayer);
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
      const el = contexts.templates.clone('node');
      const pos = node.Position ?? { x: 0, y: 0 };
      const ref = nodeRef(node.id);
      el.dataset.nodeId = node.id;
      tagItem(el, ref);
      el.tabIndex = -1;
      applyItemModes(el, ref);
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
    const drawNodes = () => {
      emit('render.view.set', {
        place: Places.Stage,
        key: 'nodes',
        view: () => {
          syncStageView();
          const view = contexts.view.get();
          const layer = contexts.templates.clone('nodes');
          layer.style.transform = `translate(${-view.x * view.scale}px, ${-view.y * view.scale}px) scale(${view.scale})`;
          const svg = contexts.templates.slot(layer, 'edges');
          const SVG_NS = 'http://www.w3.org/2000/svg';
          graphs.current.edges().forEach(edge => {
            const from = graphs.current.getNode(edge.From);
            const to = graphs.current.getNode(edge.To);
            if (!from?.Position || !to?.Position) return;
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('x1', String(from.Position.x));
            line.setAttribute('y1', String(from.Position.y));
            line.setAttribute('x2', String(to.Position.x));
            line.setAttribute('y2', String(to.Position.y));
            line.setAttribute('tabindex', '-1');
            line.dataset.edgeId = edge.id;
            const ref = edgeRef(edge.id);
            tagItem(line, ref);
            applyItemModes(line, ref);
            svg.append(line);
            if (edge.Label?.text) {
              const text = document.createElementNS(SVG_NS, 'text');
              text.setAttribute('class', 'edge-label');
              text.setAttribute('x', String((from.Position.x + to.Position.x) / 2));
              text.setAttribute('y', String((from.Position.y + to.Position.y) / 2 - 4));
              text.setAttribute('text-anchor', 'middle');
              text.textContent = edge.Label.text;
              svg.append(text);
            }
          });
          graphs.current.nodes()
            .filter(node => contexts.view.isVisible(Places.Stage, nodeRect(node), 160))
            .forEach(node => layer.append(nodeView(node)));
          drawOverlays(layer);
          return layer;
        },
      });
      const all = graphs.current.nodes();
      if (!all.length) {
        emit('render.view.set', {
          place: Places.Stage,
          key: 'empty',
          view: () => {
            const shortcut = commandShortcut(contexts.commands, 'editing.node.create');
            const hint = shortcut ? `Press <kbd>${shortcut}</kbd> to add a node` : '';
            return emptyState(contexts, 'No nodes in this graph yet', hint) ?? '';
          },
        });
      } else {
        emit('render.view.clear', { place: Places.Stage, key: 'empty' });
      }
    };

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

    type RenderScope = 'nodes' | 'outline';
    const dirty = new Set<RenderScope>();
    let scheduled = false;
    let flushes = 0;
    let pendingFocusRef: ItemRef | null = null;
    const focusPendingItem = () => {
      if (!pendingFocusRef) return;
      const item = contexts.places.el(Places.Stage)?.querySelector(itemSelector(pendingFocusRef));
      pendingFocusRef = null;
      const focusable = item as (Element & { focus?: (options?: FocusOptions) => void }) | null;
      if (typeof focusable?.focus === 'function') focusable.focus({ preventScroll: true });
    };
    const flushDirty = () => {
      scheduled = false;
      flushes++;
      if (dirty.has('nodes')) drawNodes();
      if (dirty.has('outline')) emit('outline.draw');
      dirty.clear();
      queueMicrotask(focusPendingItem);
    };
    const mark = (...scopes: RenderScope[]) => {
      scopes.forEach(s => dirty.add(s));
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flushDirty);
    };
    const applyScope = (scope: RedrawScope) =>
      scope === 'both' ? mark('nodes', 'outline') : mark(scope as RenderScope);
    // Devtools/test surface — read flush count to assert coalescing budgets.
    ctx.expose('render', { flushes: () => flushes });
    on('app.start', () => mark('nodes'));
    on('focus.item.focused', ref => { pendingFocusRef = ref; });
    bus.onAny(({ name }) => {
      const scope = factScope(name);
      if (scope) applyScope(scope);
    });
  });
}
