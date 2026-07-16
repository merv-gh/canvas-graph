import { itemParentAttr, type Registry } from '../core';
import { scopeForEvent } from '../core/redraw';
import { mountRoot } from '../core/mount';
import { Places } from '../types';
import type { ItemRef, Place, RedrawScope, Renderable } from '../types';

/** render owns the shell + slot flush + redraw scheduler — never the canvas paint.
 *  Stage drawing lives in `render.stage`, which listens for `render.stage.draw`.
 *  Outline drawing lives in `outline`, which listens for `outline.draw`. Splitting
 *  these out lets the canvas/webgl swap touch a single system. */
export function registerRender(system: Registry) {
  system('render', ctx => {
    const { on, emit, bus, contexts, frameLoop } = ctx;
    const root = mountRoot();
    const views = new Map<Place, Map<string, Renderable>>();
    const mounted = new Map<Place, Map<string, Node>>();

    const attr = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const itemSelector = (ref: ItemRef) => {
      const parent = itemParentAttr(ref.parent);
      return `[data-item-kind="${attr(ref.kind)}"][data-item-id="${attr(ref.id)}"]${parent ? `[data-item-parent="${attr(parent)}"]` : ':not([data-item-parent])'}`;
    };
    const activeElement = () => document.activeElement as (Element & { blur?: () => void }) | null;
    const modalOpen = () => !!contexts.places.el(Places.Modal)?.querySelector('.modal-layer');
    const blurActiveItem = () => {
      const active = activeElement();
      if (active?.closest('[data-item-kind][data-item-id]') && typeof active.blur === 'function') active.blur();
    };
    const nodeOf = (view: Renderable) => typeof view === 'function' ? view() : view;
    const mountedFor = (place: Place) => mounted.get(place) ?? mounted.set(place, new Map()).get(place)!;
    const tagRenderKey = (node: Node, key: string) => {
      if (node instanceof HTMLElement) node.dataset.renderKey = key;
      return node;
    };
    const removeDuplicateKey = (slot: Element, key: string, keep?: Node) => {
      [...slot.children].forEach(child => {
        if (child !== keep && child instanceof HTMLElement && child.dataset.renderKey === key) child.remove();
      });
    };
    const mountView = (place: Place, key: string, view: Renderable) => {
      const slot = contexts.places.el(place);
      if (!slot) return;
      const live = mountedFor(place);
      const previous = live.get(key);
      const next = tagRenderKey(nodeOf(view), key);
      // A hot redraw or shell remount may race a previous view replacement.
      // Render keys are singular: reconcile stale siblings before mounting so
      // overlapping command rails never leave duplicate focus targets behind.
      removeDuplicateKey(slot, key, previous);
      if (previous === next) {
        if (previous.parentNode !== slot) slot.append(previous);
        return;
      }
      if (previous?.parentNode) previous.parentNode.replaceChild(next, previous);
      else slot.append(next);
      live.set(key, next);
    };
    const remount = (place: Place) => {
      const slot = contexts.places.el(place), parts = views.get(place);
      if (!slot || !parts) return;
      const live = mountedFor(place);
      parts.forEach((view, key) => {
        const node = tagRenderKey(live.get(key) ?? nodeOf(view), key);
        removeDuplicateKey(slot, key, node);
        live.set(key, node);
        slot.append(node);
      });
    };

    on('render.shell', () => {
      root.replaceChildren(contexts.templates.clone('shell'));
      Object.values(Places).forEach(place => contexts.places.set(place, root.querySelector(`[data-place="${place}"]`)));
      Object.values(Places).forEach(remount);
    });
    on('render.view.set', ({ place, key = 'default', view }) => {
      (views.get(place) || views.set(place, new Map()).get(place)!).set(key, view);
      mountView(place, key, view);
    });
    on('render.view.clear', ({ place, key }) => {
      if (key) {
        const parts = views.get(place);
        if (!parts?.has(key)) return;
        parts.delete(key);
        const previous = mounted.get(place)?.get(key);
        previous?.parentNode?.removeChild(previous);
        mounted.get(place)?.delete(key);
      } else {
        if (!views.has(place)) return;
        views.delete(place);
        mounted.get(place)?.forEach(node => node.parentNode?.removeChild(node));
        mounted.delete(place);
      }
    });

    type RenderScope = 'nodes' | 'nodes.visual' | 'outline' | 'camera';
    const dirty = new Set<RenderScope>();
    // Patch-render bookkeeping: refs changed this frame, and a flag for any
    // change we can't localize to specific node/edge ids (→ full rebuild).
    const dirtyItems = new Map<string, ItemRef>();
    let fullNodes = false;
    /** Extract the single node/edge a fact is about, for targeted patching.
     *  Anything else (containers, graph switch, selection sets, layout) returns
     *  null → the frame falls back to a full rebuild. */
    const factItemRef = (name: string, data: unknown): ItemRef | null => {
      const d = data as Record<string, unknown> | undefined;
      if (!d) return null;
      // Direct ItemRef payload (focus.item.focused, selection.item.selected).
      if (d.kind && d.id) return d as ItemRef;
      const id = typeof d.id === 'string' ? d.id : undefined;
      if (!id) return null;
      if (name.startsWith('graph.node.')) return { kind: 'node', id };
      if (name.startsWith('graph.edge.')) return { kind: 'edge', id };
      // Events with id + namespace-implied kind (focus.node.focused, selection.node.selected, …).
      if (name.includes('.node.')) return { kind: 'node', id };
      if (name.includes('.edge.')) return { kind: 'edge', id };
      return null;
    };
    let flushes = 0;
    let scheduledRender = false;
    let lastMarkEvent = '';
    let lastFlushAt = 0;
    let markCount = 0;
    let lastDOMCount = 0;
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
    /** One frame of paint budget (60fps). Flushes above it count as
     *  `Render.flush.overBudget` — the number a WebGPU swap must drive to 0. */
    const FRAME_BUDGET_MS = 16.7;
    const flushDirty = () => {
      const t0 = performance.now();
      flushes++;
      // NOT flags.isOn('perf') — undeclared flags read as ON (isOn is
      // `!== false`), which turned this log on for everyone. perf.enabled()
      // is the real knob (?perf=1 / PERF=1 / perf flag at boot).
      const perfLog = ctx.perf.enabled();
      const scopes = perfLog ? [...dirty].join(',') : '';
      const trigger = lastMarkEvent || 'unknown';
      const hasNodes = dirty.has('nodes') || dirty.has('nodes.visual');
      const kind = !perfLog ? '' : hasNodes ? (fullNodes ? 'FULL' : `PATCH(${[...dirtyItems].map(([k]) => k).join(',')})`) + (dirty.has('nodes') ? '' : '△') :
        dirty.has('camera') ? 'CAMERA' : 'OUTLINE';
      // Gap since the previous flush = how long the scheduler sat idle. Sampled
      // so tests/perf modal can see idle cadence next to flush cost.
      const gap = lastFlushAt ? t0 - lastFlushAt : 0;
      const since = lastFlushAt ? `${gap.toFixed(1)}ms` : '-';
      lastFlushAt = t0;
      lastMarkEvent = '';
      ctx.perf.count('Render.flush');
      ctx.perf.sample('Render.flush.dirtyScopes', dirty.size);
      if (gap > 0) ctx.perf.sample('Render.flush.gapMs', gap);
      if (hasNodes) {
        ctx.perf.count('Render.flush.nodes');
        ctx.perf.sample('Render.flush.refs', dirtyItems.size);
        emit('render.stage.draw', { full: fullNodes, refs: [...dirtyItems.values()] });
      } else if (dirty.has('camera')) {
        ctx.perf.count('Render.flush.camera');
        emit('render.stage.camera');
      }
      if (dirty.has('outline')) {
        ctx.perf.count('Render.flush.outline');
        emit('outline.draw');
      }
      dirty.clear();
      dirtyItems.clear();
      fullNodes = false;
      const facts = markCount;
      markCount = 0;
      scheduledRender = false;
      const elapsed = performance.now() - t0;
      ctx.perf.sample('Render.flush.ms', elapsed);
      if (elapsed > FRAME_BUDGET_MS) ctx.perf.count('Render.flush.overBudget');
      queueMicrotask(focusPendingItem);
      // DOM census is O(subtree) — only pay for it when the perf flag is on.
      if (perfLog) {
        const domNow = contexts.places.el(Places.Stage)?.querySelectorAll('*').length ?? 0;
        const domDelta = lastDOMCount ? (domNow > lastDOMCount ? `+${domNow - lastDOMCount}` : `${domNow - lastDOMCount}`) : '';
        lastDOMCount = domNow;
        console.debug(`[render] #${flushes} ${kind} dirty=[${scopes}] trig="${trigger}" facts=${facts} dom=${domNow}(${domDelta}) +${since} took=${elapsed.toFixed(1)}ms`);
      }
    };
    const mark = (...scopes: RenderScope[]) => {
      scopes.forEach(s => dirty.add(s));
      markCount++;
      if (scheduledRender) return;
      scheduledRender = true;
      frameLoop.schedule('render.flush', flushDirty, 20);
    };
    const applyScope = (scope: RedrawScope) =>
      scope === 'both' ? mark('nodes', 'outline') :
      scope === 'nodes.visual' ? mark('nodes.visual') :
      mark(scope as RenderScope);
    ctx.expose('render', { flushes: () => flushes, lastTrigger: () => lastMarkEvent, factsPerFrame: () => markCount });
    on('app.start', () => { lastMarkEvent = 'app.start'; mark('nodes'); });
    on('focus.item.focused', ref => {
      if (!ref && pendingFocusRef) {
        dirtyItems.set(`${pendingFocusRef.kind}:${pendingFocusRef.id}`, pendingFocusRef);
      }
      pendingFocusRef = ref;
      if (!ref) pendingBlur = true;
    });
    bus.onAny(({ name, data }) => {
      const scope = scopeForEvent(name, data);
      if (!scope) return;
      lastMarkEvent = name;
      applyScope(scope);
      if (scope === 'nodes' || scope === 'nodes.visual' || scope === 'both') {
        const ref = factItemRef(name, data);
        if (ref) { dirtyItems.set(`${ref.kind}:${ref.id}`, ref); }
        else if (name === 'decoration.changed') {
          // A mode replacement affects both sides of the transition: the new
          // selected/focused ref gains a class and every previous ref loses it.
          // Decorations carries that union so patch rendering stays O(changed)
          // without leaving stale halos behind.
          const refs = (data as { refs?: ItemRef[] } | undefined)?.refs;
          if (refs?.length) refs.forEach(r => dirtyItems.set(`${r.kind}:${r.id}`, r));
          else fullNodes = true;
        }
        else if (name === 'selection.changed') {
          // Carries { refs: ItemRef[] } — extract individual refs.
          const refs = (data as { refs?: ItemRef[] } | undefined)?.refs;
          if (refs) refs.forEach(r => dirtyItems.set(`${r.kind}:${r.id}`, r));
          else fullNodes = true;
        }
        else {
          const d2 = data as { id?: unknown } | null;
          const isNullClear = (name.startsWith('focus.') || name.startsWith('selection.')) && (d2 === null || d2?.id === null);
          if (!isNullClear) fullNodes = true;
        }
      }
    });
  }, { requires: ['input'] });
}
