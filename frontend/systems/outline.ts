import { itemFoldId, nodeRef, type Registry } from '../core';
import {
  emptyRequirementsFilters,
  requirementsCapabilityPasses,
  requirementsFiltersActive,
  requirementsMapOf,
  type RequirementsCapabilityMap,
  type RequirementsFilterKey,
  type RequirementsMapMetadata,
  type RequirementsReviewFilters,
} from '../requirements-map';
import { Places } from '../types';
import { createOutlineView } from './outline-view';
import type { Id, ItemRef } from '../types';

declare module '../types' {
  interface CustomEvents {
    'outline.draw': void;
    'outline.search.changed': { query: string };
    'outline.search.clear': void;
    'outline.item.open': { graphId: Id; ref: ItemRef };
    'outline.section.open': { graphId: Id; containerId: Id; sectionId: Id };
    'outline.requirements.filter.changed': { key: RequirementsFilterKey; value: string };
    'outline.requirements.filter.clear': void;
    'outline.mobile.tab': { shift: boolean };
    'requirements.review.changed': { filters: RequirementsReviewFilters; query: string };
  }
}

const PANEL_FOLD_ID = 'outline.panel';
/** Release document navigator: the current graph name is always visible. Expand
 *  the rail to search and switch documents. Canvas content stays on canvas. */
export function registerOutline(system: Registry) {
  system('outline', ({ on, emit, contexts, graphs, frameLoop, origin }) => {
    let query = '';
    let requirementsFilters = emptyRequirementsFilters();
    let mobileRestoreFocus: HTMLElement | null = null;
    let restoreMobileOnClose = true;
    const mobileSheet = () => globalThis.innerWidth <= 680;
    const view = () => createOutlineView({
      contexts,
      graphs,
      mobileSheet,
      query,
      requirementsFilters,
    });

    const draw = () => emit('render.view.set', { place: Places.Left, key: 'outline', view: () => view().renderOutline() });
    const offCancellation = contexts.interaction.cancel.register({
      origin,
      priority: -5,
      background: false,
      active: () => contexts.fold.isOpen(PANEL_FOLD_ID),
      cancel: () => contexts.fold.set(PANEL_FOLD_ID, false),
    });
    const offMobileCancellation = contexts.interaction.cancel.register({
      origin: `${origin}.mobile`,
      priority: 50,
      background: false,
      active: () => mobileSheet() && contexts.fold.isOpen(PANEL_FOLD_ID),
      cancel: () => contexts.fold.set(PANEL_FOLD_ID, false),
    });
    const publishRequirementsReview = () => emit('requirements.review.changed', {
      filters: { ...requirementsFilters },
      query,
    });
    contexts.commands.register([
      {
        id: 'outline.search.change', label: 'Filter graph navigator', group: 'outline', hidden: true,
        event: 'outline.search.changed',
        input: { on: 'input', selector: '[data-graph-nav-search]' },
        payload: ({ target }) => ({ query: (target as HTMLInputElement).value }),
      },
      {
        id: 'outline.mobile.tab', label: 'Keep focus in the mobile graph navigator', group: 'outline', hidden: true,
        input: {
          on: 'keydown', key: 'Tab', global: true, prevent: true, stop: true,
          when: event => mobileSheet() && contexts.fold.isOpen(PANEL_FOLD_ID)
            && !!(event.target as Element | null)?.closest('.graph-navigator'),
        },
        payload: ({ event }) => ({ shift: (event as KeyboardEvent).shiftKey }),
      },
      { id: 'outline.search.clear', label: 'Clear graph filter', group: 'outline', hidden: true },
      {
        id: 'outline.requirements.filter.change',
        label: 'Filter requirements review',
        group: 'outline',
        hidden: true,
        event: 'outline.requirements.filter.changed',
        input: { on: 'change', selector: '[data-requirements-filter]' },
        payload: ({ target }) => ({
          key: (target as HTMLSelectElement).dataset.requirementsFilter as RequirementsFilterKey,
          value: (target as HTMLSelectElement).value,
        }),
      },
      { id: 'outline.requirements.filter.clear', label: 'Clear requirements filters', group: 'outline', hidden: true },
      {
        id: 'outline.section.open', label: 'Open container section', group: 'outline', hidden: true,
        payload: ({ target }) => {
          const row = (target as HTMLElement).closest<HTMLElement>('[data-section-id][data-container-id]');
          return row ? {
            graphId: row.closest('[data-graph-id]')?.getAttribute('data-graph-id') ?? graphs.current.id,
            containerId: row.dataset.containerId ?? '',
            sectionId: row.dataset.sectionId ?? '',
          } : undefined;
        },
      },
      {
        id: 'outline.item.open', label: 'Open graph item', group: 'outline', hidden: true,
        payload: ({ target }) => ({
          graphId: (target as HTMLElement).closest('[data-graph-id]')?.getAttribute('data-graph-id') ?? graphs.current.id,
          ref: {
            kind: (target as HTMLElement).closest('[data-item-kind]')?.getAttribute('data-item-kind') as ItemRef['kind'],
            id: (target as HTMLElement).closest('[data-item-id]')?.getAttribute('data-item-id') ?? '',
          },
        }),
      },
    ]);
    on('outline.search.changed', ({ query: next }) => {
      query = next;
      draw();
      publishRequirementsReview();
      queueMicrotask(() => {
        const input = contexts.places.el(Places.Left)?.querySelector<HTMLInputElement>('[data-graph-nav-search]');
        input?.focus();
        input?.setSelectionRange(input.value.length, input.value.length);
      });
    });
    on('outline.search.clear', () => { query = ''; draw(); publishRequirementsReview(); });
    on('outline.mobile.tab', ({ shift }) => {
      const panel = contexts.places.el(Places.Left)?.querySelector<HTMLElement>('.graph-navigator');
      const focusable = Array.from(panel?.querySelectorAll<HTMLElement>(
        '.graph-navigator-toggle, .graph-navigator-title, .outline-panel-body button:not([disabled]), .outline-panel-body input:not([disabled]), .outline-panel-body select:not([disabled]), .outline-panel-body textarea:not([disabled]), .outline-panel-body [href], .outline-panel-body [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? (shift ? focusable.length - 1 : 0)
        : (current + (shift ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next]?.focus({ preventScroll: true });
    });
    on('outline.requirements.filter.changed', ({ key, value }) => {
      if (!(['scope', 'readiness', 'attribute', 'component'] as string[]).includes(key)) return;
      requirementsFilters = { ...requirementsFilters, [key]: value };
      const meta = requirementsMapOf(graphs.current);
      if (key === 'attribute' && value !== 'all' && meta) {
        const attribute = meta.attributeContainers.find(candidate => candidate.id === value);
        if (attribute) {
          const id = itemFoldId({ kind: 'container', id: attribute.containerId }, graphs.current.id);
          if (!contexts.fold.isOpen(id)) contexts.fold.set(id, true);
        }
      }
      draw();
      publishRequirementsReview();
      if (meta?.capabilities && requirementsFilters.attribute !== 'all') {
        const attribute = meta.attributeContainers.find(candidate => candidate.id === requirementsFilters.attribute);
        const first = attribute?.capabilityIds.find(id => {
          const capability = meta.capabilities?.[id];
          if (!capability || !requirementsCapabilityPasses(capability, requirementsFilters)) return false;
          if (!query.trim()) return true;
          const node = graphs.current.getNode(capability.nodeId);
          return `${id} ${node?.Label.text ?? ''} ${node?.Description ?? ''}`
            .toLowerCase().includes(query.trim().toLowerCase());
        });
        const nodeId = first ? meta.capabilityNodes[first] : undefined;
        if (nodeId) frameLoop.schedule('outline.requirements.filter.focus', () => emit('view.fit.item', nodeRef(nodeId)), 60);
      }
      queueMicrotask(() => {
        contexts.places.el(Places.Left)
          ?.querySelector<HTMLSelectElement>(`[data-requirements-filter="${key}"]`)
          ?.focus();
      });
    });
    on('outline.requirements.filter.clear', () => {
      requirementsFilters = emptyRequirementsFilters();
      draw();
      publishRequirementsReview();
    });
    const revealRef = (ref: ItemRef) => {
      const reveal = [
        ...contexts.hierarchy.parentChain(ref),
        ...(ref.kind === 'container' ? [ref] : []),
      ];
      reveal.forEach(ancestor => {
        const id = itemFoldId(ancestor, graphs.current.id);
        if (!contexts.fold.isOpen(id)) contexts.fold.set(id, true);
      });
    };
    on('outline.item.open', ({ graphId, ref }) => {
      if (!ref.id || !ref.kind) return;
      if (graphs.current.id !== graphId) emit('graph.switch', { id: graphId });
      // A navigator result must be visible when it is opened. Reveal its full
      // ancestor path first; generated requirements maps then enforce their
      // one-Attribute-at-a-time reading policy through fold.changed.
      revealRef(ref);
      emit('selection.item.select', ref);
      if (mobileSheet()) {
        restoreMobileOnClose = false;
        contexts.fold.set(PANEL_FOLD_ID, false);
      }
      frameLoop.schedule('outline.open.item', () => emit('view.fit.item', ref), 45);
    });
    on('outline.section.open', ({ graphId, containerId, sectionId }) => {
      if (!containerId || !sectionId) return;
      if (graphs.current.id !== graphId) emit('graph.switch', { id: graphId });
      const ref = { kind: 'container', id: containerId } as ItemRef;
      revealRef(ref);
      emit('selection.item.select', ref);
      if (mobileSheet()) {
        restoreMobileOnClose = false;
        contexts.fold.set(PANEL_FOLD_ID, false);
      }
      // Section fitting intentionally runs after the container's unfold/layout
      // camera task and aligns the requested band to the top reading edge.
      frameLoop.schedule('outline.open.section', () => emit('view.fit.section', { containerId, sectionId }), 50);
    });
    on('app.start', () => {
      // Canvas-first default. Preserve an explicit user choice, but keep a
      // first visit focused on the document instead of opening a file tree
      // over it. The graph name and the Graphs affordance remain visible.
      const foldState = contexts.fold.all();
      const compact = globalThis.innerWidth <= 680
        || globalThis.matchMedia?.('(pointer: coarse)').matches === true;
      if (compact && contexts.fold.isOpen(PANEL_FOLD_ID)) {
        // A persisted desktop-open navigator must not cover a phone canvas on
        // reload. Users can still expand it from the compact document chip.
        contexts.fold.set(PANEL_FOLD_ID, false);
      } else if (!Object.prototype.hasOwnProperty.call(foldState, PANEL_FOLD_ID)) {
        contexts.fold.set(PANEL_FOLD_ID, false);
      }
      draw();
    });
    on('outline.draw', draw);
    on('graph.switched', () => {
      requirementsFilters = emptyRequirementsFilters();
      if (mobileSheet() && contexts.fold.isOpen(PANEL_FOLD_ID)) {
        restoreMobileOnClose = false;
        contexts.fold.set(PANEL_FOLD_ID, false);
      }
      draw();
      publishRequirementsReview();
    });
    on('fold.changed', ({ id }) => {
      const mobilePanelChange = id === PANEL_FOLD_ID && mobileSheet();
      const open = mobilePanelChange && contexts.fold.isOpen(PANEL_FOLD_ID);
      if (open) {
        mobileRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        restoreMobileOnClose = true;
      }
      if (id.startsWith('outline.') || (requirementsMapOf(graphs.current) && id.startsWith(`fold:${graphs.current.id}:`))) draw();
      if (!mobilePanelChange) return;
      frameLoop.schedule('outline.mobile.focus.prepare', () => {
        frameLoop.schedule('outline.mobile.focus.commit', () => {
          if (contexts.fold.isOpen(PANEL_FOLD_ID)) {
            contexts.places.el(Places.Left)?.querySelector<HTMLElement>('.graph-navigator-toggle')?.focus({ preventScroll: true });
            return;
          }
          const target = restoreMobileOnClose ? mobileRestoreFocus : null;
          mobileRestoreFocus = null;
          restoreMobileOnClose = true;
          if (target?.isConnected) target.focus({ preventScroll: true });
          else if (target) contexts.places.el(Places.Left)?.querySelector<HTMLElement>('.graph-navigator-toggle')?.focus({ preventScroll: true });
        }, 45);
      }, 45);
    });
    return () => {
      offMobileCancellation();
      offCancellation();
    };
  }, { requires: ['render', 'graph'] });
}
