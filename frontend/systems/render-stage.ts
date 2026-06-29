import { commandShortcut, edgeRef, emptyState, foldHidden, itemFoldId, kbdHint, tagItem, type Registry } from '../core';
import { Places, Slots } from '../types';
import type { ActionDef, AffordanceDef, EntityDef, EntityRenderCtx, ItemRef } from '../types';
import { uiValue } from '../core';

/** render.stage owns the stage paint: nodes, edges, overlays, empty state.
 *  Listens for `render.stage.draw` from the render scheduler — never schedules
 *  by itself — and pushes results back through `render.view.set`. This split
 *  lets the scheduler (in `render`) stay in charge of coalescing while the
 *  stage renderer is swappable (HTML today, canvas/webgl tomorrow). */
export function registerRenderStage(system: Registry) {
  system('render.stage', ctx => {
    const { on, emit, graphs, contexts, model } = ctx;

    const applyAffordance = <T>(el: HTMLElement, item: T, ui: AffordanceDef<T>) => {
      if (ui.className) el.classList.add(...ui.className.split(/\s+/).filter(Boolean));
      Object.entries(ui.attrs ?? {}).forEach(([name, value]) => el.setAttribute(name, uiValue(value, item)));
    };
    const affordanceButton = <T>(item: T, actionDef: ActionDef<T>, ui: AffordanceDef<T>) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = ui.command;
      button.textContent = uiValue(ui.text, item, actionDef.label);
      button.setAttribute('aria-label', uiValue(ui.label, item, actionDef.label));
      applyAffordance(button, item, ui);
      return button;
    };
    const wireItemAffordances = <T>(el: HTMLElement, entityDef: EntityDef<T>, item: T) => {
      const grouped = new Map<string, { action: ActionDef<T>; ui: AffordanceDef<T> }[]>();
      contexts.affordances.entity(entityDef).forEach(({ action, ui }) => {
        const slotName = ui.slot ?? Slots.Header;
        (grouped.get(slotName) ?? grouped.set(slotName, []).get(slotName)!).push({ action: action as ActionDef<T>, ui: ui as AffordanceDef<T> });
      });
      grouped.forEach((entries, slotName) => {
        const target = el.querySelector(`[data-slot="${slotName}"]`);
        if (!(target instanceof HTMLElement)) return;
        entries.forEach(({ action, ui }) => {
          if (ui.kind === 'handler') applyAffordance(target, item, ui);
          if (ui.kind === 'button') target.append(affordanceButton(item, action, ui));
        });
      });
    };
    const applyItemModes = (el: Element, ref: ItemRef) => {
      const classes = [...new Set(contexts.decorations.modes.for(ref).map(mode => mode.className ?? mode.mode).filter(Boolean))];
      if (!classes.length) return;
      el.classList.add(...classes);
      el.setAttribute('data-item-modes', classes.join(' '));
    };
    /** Compute the bounds rect for any ref by looking up its entity's renderer
     *  and calling its `bounds(item)` (the same hook used for culling). Returns
     *  null when no entity/item/bounds is available — edge renderers fall back
     *  to a small dot at the node's center. */
    const boundsOfRef = (ref: ItemRef): import('../types').Rect | null => {
      const entityDef = model.entity(ref.kind) as EntityDef<unknown> | undefined;
      const item = graphs.current.getItem(ref);
      if (!entityDef || !item) return null;
      return entityDef.render?.bounds?.(item) ?? null;
    };
    const renderCtxFor = <T>(entityDef: EntityDef<T>, item: T): EntityRenderCtx => ({
      graph: graphs.current,
      refOf: (id) => {
        const base = { kind: entityDef.kind as ItemRef['kind'], id };
        const parent = contexts.hierarchy.parentIds(base);
        return parent ? { ...base, parent } : base;
      },
      tagItem,
      applyItemModes,
      wireAffordances: el => wireItemAffordances(el, entityDef, item),
      cloneTemplate: <R extends Element = HTMLElement>(name: string) => contexts.templates.clone(name) as unknown as R,
      templateSlot: (templateRoot, name) => contexts.templates.slot(templateRoot, name),
      templateText: (templateRoot, name, value) => { contexts.templates.text(templateRoot, name, value); },
      parentChain: ref => contexts.hierarchy.parentChain(ref),
      isFolded: ref => contexts.fold.folded(itemFoldId(ref, graphs.current.id)),
      boundsOf: boundsOfRef,
    });
    /** True when any ancestor of `ref` is `Collapsed`. Collapsed containers
     *  hide their entire subtree — the children stay in the data store (so
     *  expand brings them back instantly), they're just skipped here. */
    const hiddenByCollapsedAncestor = (ref: ItemRef): boolean =>
      foldHidden(ref, contexts.hierarchy.parentChain, contexts.fold, graphs.current.id);
    const syncStageView = () => {
      const stage = contexts.places.el(Places.Stage), view = contexts.view.get();
      if (!stage) return;
      stage.style.setProperty('--grid-size', `${32 * view.scale}px`);
      stage.style.setProperty('--grid-x', `${-view.x * view.scale}px`);
      stage.style.setProperty('--grid-y', `${-view.y * view.scale}px`);
      stage.dataset.zoom = `${Math.round(view.scale * 100)}%`;
    };
    const layerTransform = (view: import('../types').ViewState) =>
      `translate(${-view.x * view.scale}px, ${-view.y * view.scale}px) scale(${view.scale})`;

    // ----- Persistent layer + element index (patch-driven render) -----
    // The nodes layer is built once and kept; subsequent entity changes patch
    // only the affected elements instead of rebuilding all N. `els` maps an item
    // key → its live DOM node. The layer element itself is handed to the render
    // scheduler (not a rebuilding thunk), so flushes from other Stage keys
    // (overlays, toolbar) just re-append the same element — they no longer
    // trigger a full node rebuild.
    let layer: HTMLElement | null = null;
    let svgLayer: HTMLElement | null = null;
    const els = new Map<string, HTMLElement>();
    const keyOf = (ref: ItemRef) => `${ref.kind}:${ref.id}:${(ref.parent ?? []).join('/')}`;
    const refOf = (kind: string, item: unknown): ItemRef | null => {
      const id = (item as { id?: string }).id;
      if (!id) return null;
      const ref: ItemRef = { kind: kind as ItemRef['kind'], id };
      const parent = contexts.hierarchy.parentIds(ref);
      if (parent) ref.parent = parent;
      return ref;
    };
    const targetLayer = (renderer: NonNullable<EntityDef<unknown>['render']>) =>
      renderer.layer === 'svg' ? svgLayer! : layer!;

    // ----- Viewport culling (spatial grid) -----
    // Only build DOM for what's near the viewport. The model's grid answers
    // "nodes in this rect" in O(cells+hits) — no per-frame O(N) scan. Edges
    // shown when incident to a visible node; other kinds (containers) aren't
    // gridded yet, so they render unconditionally. `null` = no viewport
    // (headless/tests with no stage rect) → render everything.
    const CULL_MARGIN = 200;
    const visibleNodeIds = (): Set<string> | null => {
      const rect = contexts.view.visibleRect(Places.Stage, CULL_MARGIN);
      return rect ? new Set(graphs.current.nodeIdsInRect(rect)) : null;
    };

    type Desired = { ref: ItemRef; def: EntityDef<unknown>; item: unknown };
    /** Everything that should currently be on the stage, keyed by element key. */
    const collectDesired = (visible: Set<string> | null): Map<string, Desired> => {
      const desired = new Map<string, Desired>();
      const nodeIds = new Set<string>();
      const nodeDef = model.entity('node') as EntityDef<unknown> | undefined;
      if (nodeDef?.render) {
        const nodes = visible
          ? [...visible].map(id => graphs.current.getNode(id)).filter((n): n is NonNullable<typeof n> => !!n)
          : graphs.current.nodes();
        nodes.forEach(node => {
          const ref = refOf('node', node);
          if (!ref || hiddenByCollapsedAncestor(ref)) return;
          desired.set(keyOf(ref), { ref, def: nodeDef, item: node });
          nodeIds.add(ref.id);
        });
      }
      const edgeDef = model.entity('edge') as EntityDef<unknown> | undefined;
      if (edgeDef?.render) {
        const edges = visible ? [...nodeIds].flatMap(id => graphs.current.edgesOf(id)) : graphs.current.edges();
        edges.forEach(edge => {
          const ref = edgeRef(edge.id);
          desired.set(keyOf(ref), { ref, def: edgeDef, item: edge });
        });
      }
      model.entities().forEach(def => {
        if (def.kind === 'node' || def.kind === 'edge' || !def.render) return;
        graphs.current.itemsOfKind(def.kind).forEach(item => {
          const ref = refOf(def.kind, item);
          if (!ref || hiddenByCollapsedAncestor(ref)) return;
          desired.set(keyOf(ref), { ref, def, item });
        });
      });
      return desired;
    };

    /** Reconcile the DOM to the desired set. `rebuild` makes a fresh layer (first
     *  paint / graph switch); otherwise it diffs against the live layer — pan/zoom
     *  only insert nodes entering the viewport and remove those leaving, never
     *  touching the elements that stay (so camera moves are O(delta)). */
    const reconcile = (rebuild: boolean) => {
      syncStageView();
      const fresh = rebuild || !layer;
      if (fresh) {
        layer = contexts.templates.clone('nodes') as HTMLElement;
        svgLayer = contexts.templates.slot(layer, 'edges') as HTMLElement;
        els.clear();
      }
      layer!.style.transform = layerTransform(contexts.view.get());
      const desired = collectDesired(visibleNodeIds());
      [...els.keys()].forEach(k => { if (!desired.has(k)) { els.get(k)?.remove(); els.delete(k); } });
      desired.forEach(({ def, item }, k) => {
        if (els.has(k)) return; // already on stage — leave it (cheap camera moves)
        const el = def.render!.draw(item, renderCtxFor(def, item)) as HTMLElement | null;
        if (el) { targetLayer(def.render!).append(el); els.set(k, el); }
      });
      if (fresh) emit('render.view.set', { place: Places.Stage, key: 'nodes', view: layer! });
    };
    const drawAll = () => reconcile(true);

    /** Patch one item in place: insert / replace / remove. `visible` gates node
     *  membership so a patched node that moved out of the viewport is dropped. */
    const patchOne = (ref: ItemRef, visible: Set<string> | null) => {
      const k = keyOf(ref);
      const existing = els.get(k);
      const entityDef = model.entity(ref.kind) as EntityDef<unknown> | undefined;
      const renderer = entityDef?.render;
      const item = renderer ? graphs.current.getItem(ref) : undefined;
      const culled = ref.kind === 'node' && !!visible && !visible.has(ref.id);
      const hidden = (ref.kind !== 'edge' && hiddenByCollapsedAncestor(ref)) || culled;
      const fresh = (renderer && item && !hidden)
        ? renderer.draw(item, renderCtxFor(entityDef!, item)) as HTMLElement | null
        : null;
      if (!fresh) { existing?.remove(); els.delete(k); return; }
      if (existing) existing.replaceWith(fresh);
      else targetLayer(renderer!).append(fresh);
      els.set(k, fresh);
    };

    /** Patch the changed refs (+ edges incident to any moved node, whose paths
     *  depend on endpoint positions). Falls back to a full rebuild if the layer
     *  isn't built yet. */
    const patchItems = (refs: ItemRef[]) => {
      if (!layer) { drawAll(); return; }
      syncStageView();
      layer.style.transform = layerTransform(contexts.view.get());
      // Normalize parents so keys match what drawAll stored (container children
      // carry a parent chain; the scheduler's bare {kind,id} does not).
      const norm = (ref: ItemRef): ItemRef => {
        const parent = contexts.hierarchy.parentIds(ref);
        return parent ? { ...ref, parent } : ref;
      };
      const todo = new Map<string, ItemRef>();
      refs.forEach(r0 => {
        const ref = norm(r0);
        todo.set(keyOf(ref), ref);
        if (ref.kind === 'node') graphs.current.edgesOf(ref.id).forEach(e => {
          const er = norm(edgeRef(e.id)); todo.set(keyOf(er), er);
        });
      });
      const visible = visibleNodeIds();
      todo.forEach(ref => patchOne(ref, visible));
    };

    const drawStageOverlays = () => emit('render.view.set', {
      place: Places.Stage,
      key: 'overlays',
      view: () => {
        const layer = document.createElement('div');
        layer.className = 'item-overlays';
        contexts.decorations.overlays.all().forEach(overlay => {
          const anchor = contexts.hierarchy.anchor(overlay.ref);
          if (!anchor) return;
          const screen = contexts.view.spaceToScreen(anchor);
          const el = document.createElement('div');
          el.className = 'item-overlay';
          if (overlay.className) el.classList.add(...overlay.className.split(/\s+/).filter(Boolean));
          tagItem(el, overlay.ref);
          if (overlay.id) el.dataset.overlayId = overlay.id;
          el.textContent = overlay.text;
          el.style.left = `${screen.x}px`;
          el.style.top = `${screen.y}px`;
          layer.append(el);
        });
        return layer;
      },
    });

    const drawEmptyState = () => {
      // "Empty" means *nothing renderable* on the stage — not just zero nodes.
      // A graph with containers (even no nodes) shouldn't show "press A to add
      // a node", so walk every rendered entity kind and count items.
      const hasAnyItem = model.entities().some(entityDef =>
        entityDef.render && graphs.current.itemsOfKind(entityDef.kind).length > 0,
      );
      if (hasAnyItem) {
        emit('render.view.clear', { place: Places.Stage, key: 'empty' });
        return;
      }
      emit('render.view.set', {
        place: Places.Stage,
        key: 'empty',
        view: () => {
          const shortcut = commandShortcut(contexts.commands, 'editing.node.create');
          const hint = shortcut ? kbdHint('Press ', shortcut, ' to add a node') : undefined;
          return emptyState(contexts.templates, 'No nodes in this graph yet', hint) ?? document.createDocumentFragment();
        },
      });
    };

    /** Camera-only redraw: pan/zoom moved the view but no entity changed. Move
     *  the persistent layer's transform + grid in place — O(1), no rebuild.
     *  Overlays are screen-positioned, so refresh those too (usually none). */
    const applyCamera = () => {
      // Pan/zoom: move the transform AND reconcile the viewport so nodes scrolling
      // into view appear and those leaving are dropped (incremental — only the
      // delta is touched, existing elements stay put).
      if (layer) reconcile(false);
      else { syncStageView(); }
      drawStageOverlays();
    };

    on('render.stage.draw', ({ full, refs }) => {
      if (full || !refs?.length || !layer) drawAll();
      else patchItems(refs);
      drawStageOverlays();
      drawEmptyState();
    });
    on('render.stage.camera', applyCamera);
  }, { requires: ['render', 'graph'] });
}
