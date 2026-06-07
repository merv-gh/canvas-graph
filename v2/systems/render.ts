import type { GraphNode } from '../model';
import {
  appendRenderable,
  commandShortcut,
  emptyState,
  entityUi,
  nodeRect,
  uiValue,
  type Registry,
} from '../core';
import { Places } from '../types';
import type { ActionDef, AffordanceDef, Place, Renderable } from '../types';

export function registerRender(system: Registry) {
  system('render', ({ on, emit, bus, graphs, contexts, model, selection }) => {
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
      entityUi(entityDef, 'header')
        .filter(({ ui }) => ui.kind === 'handler')
        .forEach(({ ui }) => applyAffordance(contexts.templates.slot(el, 'header'), node, ui));
      entityUi(entityDef, 'title')
        .filter(({ ui }) => ui.kind === 'handler')
        .forEach(({ ui }) => applyAffordance(contexts.templates.slot(el, 'title'), node, ui));
      (['header:start', 'header:end'] as const).forEach(slot => {
        const target = contexts.templates.slot(el, slot);
        entityUi(entityDef, slot)
          .filter(({ ui }) => ui.kind === 'button')
          .forEach(({ action, ui }) => target.append(affordanceButton(node, action, ui)));
      });
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
      el.dataset.nodeId = node.id;
      el.classList.toggle('selected', selection.selected() === node.id);
      el.classList.toggle('focused', selection.focused() === node.id);
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
            line.dataset.edgeId = edge.id;
            line.dataset.itemId = edge.id;
            line.dataset.itemKind = edge.kind;
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

    const dirty = new Set<'nodes' | 'outline'>();
    let scheduled = false;
    const flushDirty = () => {
      scheduled = false;
      if (dirty.has('nodes')) drawNodes();
      if (dirty.has('outline')) emit('outline.draw');
      dirty.clear();
    };
    const mark = (...scopes: ('nodes' | 'outline')[]) => {
      scopes.forEach(s => dirty.add(s));
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(flushDirty);
    };
    on('app.start', () => mark('nodes'));
    bus.onAny(({ name }) => {
      if (name === 'render.nodes.draw') return mark('nodes');
      if (name === 'outline.draw') return;
      if (name.startsWith('render.')) return;
      if (name === 'view.changed') return mark('nodes');
      if (/(?:^graph\.(?:switched|deleted)$|^graph\.node\.(?:created|updated|deleted)$|^graph\.edge\.(?:created|updated|deleted)$|^(?:selection|focus)\.node\.(?:selected|focused)$)/.test(name)) {
        return mark('nodes', 'outline');
      }
      if (name === 'graph.created') return mark('outline');
    });
  });
}
