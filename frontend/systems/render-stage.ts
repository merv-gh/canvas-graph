import { commandShortcut, edgeRef, emptyState, foldHidden, itemFoldId, kbdHint, tagItem, type Registry } from '../core';
import { expandRect, rectsOverlap } from '../core/geometry';
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
        if (ui.when && !ui.when(item)) return;
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
      boundsInRect: (kind, area) => {
        const entityDef = model.entity(kind) as EntityDef<unknown> | undefined;
        const bounds = entityDef?.render?.bounds;
        if (!bounds) return [];
        // Node sizes are clamped to 900 graph units. Query centers with a
        // half-size margin, then refine against the renderer's exact bounds.
        const items = kind === 'node'
          ? graphs.current.nodeIdsInRect(expandRect(area, 450)).flatMap(id => {
              const item = graphs.current.getItem({ kind: 'node', id });
              return item ? [item] : [];
            })
          : graphs.current.itemsOfKind(kind);
        return items.flatMap(item => {
          const rect = bounds(item);
          return rect && rectsOverlap(rect, area) ? [rect] : [];
        });
      },
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
      stage.dataset.zoomBand = view.scale < 0.5 ? 'far' : view.scale < 0.72 ? 'overview' : 'detail';
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
    // Last-drawn signature per element (everything but position). Lets a patch
    // take the in-place `reposition` fast path when only the position moved.
    const sigCache = new Map<string, string>();
    const modeKey = (ref: ItemRef) =>
      contexts.decorations.modes.for(ref).map(m => m.mode).sort().join(',');
    const cacheSig = (k: string, def: EntityDef<unknown>, item: unknown, ref?: ItemRef) => {
      const sig = def.render?.signature?.(item);
      const modes = ref ? `|modes:${modeKey(ref)}` : '';
      if (sig !== undefined) sigCache.set(k, sig + modes);
      else sigCache.delete(k);
    };
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
    // Stable z-layering. The viewport reconcile appends entering nodes in
    // arbitrary (grid) order, so DOM order can't carry stacking. Instead each
    // node gets a z-index keyed by its creation sequence (the numeric id suffix):
    // a node leaving and re-entering the viewport always restacks identically —
    // no flicker — without reordering the DOM. Edges sit in the svg sublayer
    // beneath all nodes structurally.
    const stableZ = (ref: ItemRef, el: HTMLElement) => {
      if (ref.kind !== 'node') return;
      const seq = parseInt(ref.id.replace(/^\D+/, ''), 10);
      if (Number.isFinite(seq)) el.style.zIndex = String(seq);
    };

    // ----- Viewport culling (spatial grid) -----
    // Only build DOM for what's near the viewport. The model's grid answers
    // "nodes in this rect" in O(cells+hits) — no per-frame O(N) scan. Edges
    // shown when incident to a visible node; other kinds (containers) aren't
    // gridded yet, so they render unconditionally. `null` = no viewport
    // (headless/tests with no stage rect) → render everything.
    const CULL_MARGIN = 200;
    const visibleNodeIds = (): Set<string> | null => {
      const rect = contexts.view.visibleRect(Places.Stage, CULL_MARGIN);
      if (!rect) return null;
      const ids = graphs.current.nodeIdsInRect(rect);
      ctx.perf.sample('Render.stage.visibleNodeCandidates', ids.length);
      return new Set(ids);
    };

    type Desired = { ref: ItemRef; def: EntityDef<unknown>; item: unknown };
    /** Everything that should currently be on the stage, keyed by element key. */
    const collectDesired = (visible: Set<string> | null): Map<string, Desired> => {
      const desired = new Map<string, Desired>();
      const hidden = (r: { kind: string; id: string }) =>
        hiddenByCollapsedAncestor({ kind: r.kind as import('../types').ItemRef['kind'], id: r.id });
      model.entities().forEach(def => {
        const renderer = def.render;
        if (!renderer) return;
        const items: unknown[] = renderer.collect
          ? renderer.collect(graphs.current, hidden, visible) as unknown[]
          : graphs.current.itemsOfKind(def.kind);
        items.forEach(item => {
          const ref = refOf(def.kind, item);
          if (!ref) return;
          if (def.kind !== 'edge' && hiddenByCollapsedAncestor(ref)) return;
          desired.set(keyOf(ref), { ref, def, item });
        });
      });
      ctx.perf.sample('Render.stage.desiredItems', desired.size);
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
        sigCache.clear();
      }
      layer!.style.transform = layerTransform(contexts.view.get());
      const desired = collectDesired(visibleNodeIds());
      let removed = 0;
      let inserted = 0;
      [...els.keys()].forEach(k => {
        if (!desired.has(k)) {
          els.get(k)?.remove();
          els.delete(k);
          sigCache.delete(k);
          removed++;
        }
      });
      desired.forEach(({ ref, def, item }, k) => {
        if (els.has(k)) return; // already on stage — leave it (cheap camera moves)
        const el = ctx.perf.measure(`Render.entity.${def.kind}.draw`, () =>
          def.render!.draw(item, renderCtxFor(def, item)) as HTMLElement | null,
        );
        if (el) {
          stableZ(ref, el);
          targetLayer(def.render!).append(el);
          els.set(k, el);
          cacheSig(k, def, item, ref);
          inserted++;
        }
      });
      ctx.perf.count('Render.stage.itemsInserted', inserted);
      ctx.perf.count('Render.stage.itemsRemoved', removed);
      ctx.perf.sample('Render.stage.liveItems', els.size);
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
      const edgeCulled = ref.kind === 'edge' && !!visible && !!item
        && !visible.has((item as { From?: string }).From ?? '')
        && !visible.has((item as { To?: string }).To ?? '');
      const hidden = (ref.kind !== 'edge' && hiddenByCollapsedAncestor(ref)) || culled || edgeCulled;
      if (!renderer || !item || hidden) { existing?.remove(); els.delete(k); sigCache.delete(k); return; }
      // Fast path: the element exists and nothing but its position changed →
      // move it in place (no rebuild, keeps identity so CSS can ease the move).
      if (existing && renderer.reposition && renderer.signature) {
        const dataSig = renderer.signature(item);
        const fullSig = dataSig + `|modes:${modeKey(ref)}`;
        if (fullSig === sigCache.get(k)) {
          ctx.perf.count('Render.stage.reposition');
          renderer.reposition(existing, item, renderCtxFor(entityDef!, item));
          return;
        }
      }
      const fresh = ctx.perf.measure(`Render.entity.${ref.kind}.draw`, () =>
        renderer.draw(item, renderCtxFor(entityDef!, item)) as HTMLElement | null,
      );
      if (!fresh) { existing?.remove(); els.delete(k); sigCache.delete(k); return; }
      stableZ(ref, fresh);
      if (existing) existing.replaceWith(fresh);
      else targetLayer(renderer).append(fresh);
      els.set(k, fresh);
      cacheSig(k, entityDef!, item, ref);
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
      ctx.perf.sample('Render.stage.patchRefs', refs.length);
      ctx.perf.sample('Render.stage.patchItems', todo.size);
      todo.forEach(ref => patchOne(ref, visible));
      ctx.perf.sample('Render.stage.liveItems', els.size);
    };

    let overlaysMounted = false;
    const drawStageOverlays = () => {
      const overlays = contexts.decorations.overlays.all();
      if (!overlays.length) {
        if (overlaysMounted) {
          overlaysMounted = false;
          emit('render.view.clear', { place: Places.Stage, key: 'overlays' });
        }
        return;
      }
      overlaysMounted = true;
      emit('render.view.set', {
        place: Places.Stage,
        key: 'overlays',
        view: () => {
          const layer = document.createElement('div');
          layer.className = 'item-overlays';
          overlays.forEach(overlay => {
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
    };

    let emptyMounted = false;
    const drawEmptyState = () => {
      // "Empty" means *nothing renderable* on the stage — not just zero nodes.
      // A graph with containers (even no nodes) shouldn't show "press A to add
      // a node", so walk every rendered entity kind and count items.
      const hasAnyItem = model.entities().some(entityDef =>
        entityDef.render && graphs.current.itemsOfKind(entityDef.kind).length > 0,
      );
      if (hasAnyItem) {
        if (emptyMounted) {
          emptyMounted = false;
          emit('render.view.clear', { place: Places.Stage, key: 'empty' });
        }
        return;
      }
      emptyMounted = true;
      emit('render.view.set', {
        place: Places.Stage,
        key: 'empty',
        view: () => {
          const shortcut = commandShortcut(contexts.commands, 'editing.node.create');
          const hint = document.createDocumentFragment();
          const purpose = document.createElement('span');
          purpose.className = 'empty-purpose';
          purpose.textContent = 'Map a system, workflow, or connected idea.';
          hint.append(purpose);
          if (shortcut) hint.append(kbdHint('Press ', shortcut, ' to add a node'));
          return emptyState(contexts.templates, 'No nodes in this graph yet', hint, 'editing.node.create') ?? document.createDocumentFragment();
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
      ctx.perf.measure('Render.stage.draw', () => {
        if (full || !refs?.length || !layer) {
          ctx.perf.count('Render.stage.fullDraw');
          drawAll();
        } else {
          ctx.perf.count('Render.stage.patchDraw');
          patchItems(refs);
        }
        drawStageOverlays();
        drawEmptyState();
      });
    });
    on('render.stage.camera', () => {
      ctx.perf.count('Render.stage.cameraDraw');
      ctx.perf.measure('Render.stage.camera', applyCamera);
    });
    // While a pointer-drag is active, suppress the node move-easing so the dragged
    // node tracks the cursor 1:1 (easing is for discrete keyboard nudges only).
    on('drag.item.start', () => contexts.places.el(Places.Stage)?.classList.add('dragging'));
    on('drag.item.end', () => contexts.places.el(Places.Stage)?.classList.remove('dragging'));
  }, { requires: ['render', 'graph'] });
}
