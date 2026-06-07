import { appendRenderable, factScope, type Registry } from '../core';
import { Places } from '../types';
import type { ItemRef, Place, RedrawScope, Renderable } from '../types';

/** render owns the shell + slot flush + redraw scheduler — never the canvas paint.
 *  Stage drawing lives in `render.stage`, which listens for `render.stage.draw`.
 *  Outline drawing lives in `outline`, which listens for `outline.draw`. Splitting
 *  these out lets the canvas/webgl swap touch a single system. */
export function registerRender(system: Registry) {
  system('render', ctx => {
    const { on, emit, bus, contexts } = ctx;
    const root = document.getElementById('app')!;
    const views = new Map<Place, Map<string, Renderable>>();

    const itemSelector = (ref: ItemRef) =>
      `[data-item-kind="${ref.kind}"][data-item-id="${ref.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    const activeElement = () => document.activeElement as (Element & { blur?: () => void }) | null;
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

    type RenderScope = 'nodes' | 'outline';
    const dirty = new Set<RenderScope>();
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
      const item = contexts.places.el(Places.Stage)?.querySelector(itemSelector(pendingFocusRef));
      pendingFocusRef = null;
      const focusable = item as (Element & { focus?: (options?: FocusOptions) => void }) | null;
      if (typeof focusable?.focus === 'function') focusable.focus({ preventScroll: true });
    };
    const flushDirty = () => {
      scheduled = false;
      flushes++;
      if (dirty.has('nodes')) emit('render.stage.draw');
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
    ctx.expose('render', { flushes: () => flushes });
    on('app.start', () => mark('nodes'));
    on('focus.item.focused', ref => {
      pendingFocusRef = ref;
      if (!ref) pendingBlur = true;
    });
    bus.onAny(({ name }) => {
      const scope = factScope(name);
      if (scope) applyScope(scope);
    });
  });
}
