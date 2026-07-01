import { appendRenderable, factScope, itemParentAttr, type Registry } from '../core';
import { mountRoot } from '../core/mount';
import { Places } from '../types';
import type { ItemRef, Place, RedrawScope, Renderable } from '../types';

/** render owns the shell + slot flush + redraw scheduler — never the canvas paint.
 *  Stage drawing lives in `render.stage`, which listens for `render.stage.draw`.
 *  Outline drawing lives in `outline`, which listens for `outline.draw`. Splitting
 *  these out lets the canvas/webgl swap touch a single system. */
export function registerRender(system: Registry) {
  system('render', ctx => {
    const { on, emit, bus, contexts } = ctx;
    const root = mountRoot();
    const views = new Map<Place, Map<string, Renderable>>();

    const attr = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const itemSelector = (ref: ItemRef) => {
      const parent = itemParentAttr(ref.parent);
      return `[data-item-kind="${attr(ref.kind)}"][data-item-id="${attr(ref.id)}"]${parent ? `[data-item-parent="${attr(parent)}"]` : ':not([data-item-parent])'}`;
    };
    const activeElement = () => document.activeElement as (Element & { blur?: () => void }) | null;
    const modalOpen = () => (contexts.places.el(Places.Modal)?.children.length ?? 0) > 0;
    const blurActiveItem = () => {
      const active = activeElement();
      if (active?.closest('[data-item-kind][data-item-id]') && typeof active.blur === 'function') active.blur();
    };
    const flush = (place: Place) => {
      const slot = contexts.places.el(place), parts = views.get(place);
      if (!slot || !parts) return;
      slot.replaceChildren();
      [...parts.values()].forEach(view => appendRenderable(slot, view));
    };

    on('render.shell', () => {
      root.replaceChildren(contexts.templates.clone('shell'));
      Object.values(Places).forEach(place => contexts.places.set(place, root.querySelector(`[data-place="${place}"]`)));
      Object.values(Places).forEach(flush);
    });
    on('render.view.set', ({ place, key = 'default', view }) => {
      (views.get(place) || views.set(place, new Map()).get(place)!).set(key, view);
      flush(place);
    });
    on('render.view.clear', ({ place, key }) => { key ? views.get(place)?.delete(key) : views.delete(place); flush(place); });

    type RenderScope = 'nodes' | 'outline' | 'camera';
    const dirty = new Set<RenderScope>();
    // Patch-render bookkeeping: refs changed this frame, and a flag for any
    // change we can't localize to specific node/edge ids (→ full rebuild).
    const dirtyItems = new Map<string, ItemRef>();
    let fullNodes = false;
    /** Extract the single node/edge a fact is about, for targeted patching.
     *  Anything else (containers, graph switch, selection sets, layout) returns
     *  null → the frame falls back to a full rebuild. */
    const factItemRef = (name: string, data: unknown): ItemRef | null => {
      const id = (data as { id?: string } | undefined)?.id;
      if (!id) return null;
      if (name.startsWith('graph.node.')) return { kind: 'node', id };
      if (name.startsWith('graph.edge.')) return { kind: 'edge', id };
      return null;
    };
    let scheduled = false;
    let flushes = 0;
    let pendingFocusRef: ItemRef | null = null;
    let pendingBlur = false;
    const focusPendingItem = () => {
      if (pendingBlur) {
        pendingBlur = false;
        blurActiveItem();
      }
      if (!pendingFocusRef) return;
      if (modalOpen()) {
        pendingFocusRef = null;
        return;
      }
      const item = contexts.places.el(Places.Stage)?.querySelector(itemSelector(pendingFocusRef));
      pendingFocusRef = null;
      const focusable = item as (Element & { focus?: (options?: FocusOptions) => void }) | null;
      if (typeof focusable?.focus === 'function') focusable.focus({ preventScroll: true });
    };
    const flushDirty = () => {
      scheduled = false;
      flushes++;
      // A full stage draw already re-applies the camera, so only emit the
      // camera-only path when the nodes scope isn't also dirty this frame.
      if (dirty.has('nodes')) emit('render.stage.draw', { full: fullNodes, refs: [...dirtyItems.values()] });
      else if (dirty.has('camera')) emit('render.stage.camera');
      if (dirty.has('outline')) emit('outline.draw');
      dirty.clear();
      dirtyItems.clear();
      fullNodes = false;
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
    ctx.expose('render', { flushes: () => flushes });
    on('app.start', () => mark('nodes'));
    on('focus.item.focused', ref => {
      pendingFocusRef = ref;
      if (!ref) pendingBlur = true;
    });
    bus.onAny(({ name, data }) => {
      const scope = factScope(name);
      if (!scope) return;
      applyScope(scope);
      if (scope === 'nodes' || scope === 'both') {
        const ref = factItemRef(name, data);
        if (ref) dirtyItems.set(`${ref.kind}:${ref.id}`, ref);
        else fullNodes = true; // change we can't localize → rebuild all
      }
    });
  }, { requires: ['input'] });
}
