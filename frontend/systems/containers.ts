import { boundsOf, createNesting, expandRect, itemFoldId, itemIdFrom, rectCenter, refKey, sameItemRef, unionRect, type NestApi, type Registry } from '../core';
import { Places } from '../types';
import type {
  Id,
  ItemRef,
  Position,
  Rect,
  Size,
} from '../types';
import {
  createContainerEntity,
  DEFAULT_CONTAINER_SIZE,
  firstSectionId,
  sanitizeContainerSections,
  type Container,
  type ContainerPatch,
  type SectionAxis,
} from './container-entity';

/**
 * Container system — one file, one mental model.
 *
 * Container is a *kind*. Its data, abilities, renderer, commands, and storage
 * handler live here. Everything reusable (parent walking + cycle guard,
 * geometry) lives behind `createNesting` / `boundsOf|unionRect|expandRect`
 * in core, so this file stays focused on container-specific policy.
 *
 * State is per-graph: switching graphs hides containers that belong to other
 * graphs (they live in their own state bucket keyed by graph id). Deleting a
 * graph drops its bucket.
 */

declare module '../types' {
  interface CustomItemKinds { container: unknown }
  interface CustomEvents {
    'editing.container.create': { Label?: { text: string }; at?: Position };
    'container.created': { id: Id };
    'container.updated': { id: Id };
    'graph.container.delete': { id: Id };
    'container.deleted': { id: Id };
    'container.add-child': { containerId: Id; childRef: ItemRef; sectionId?: Id };
    'container.remove-child': { childRef: ItemRef };
    'container.child.section.set': { containerId?: Id; childRef?: ItemRef; sectionId?: Id };
    'container.section.title.edit': { containerId: Id; sectionId: Id };
    'container.section.title.commit': { containerId: Id; sectionId: Id; title: string; finish?: boolean };
    'container.section.resize.start': { containerId: Id; index: number; x: number; y: number };
    'container.section.resize.move': { x: number; y: number };
    'container.section.resize.end': void;
    'container.children.changed': { id: Id };
    'container.import.snapshot': { containers: { id: Id; label: string; children: Id[] }[] };
  }
}

/** Compact size used when collapsed — just enough room for the label badge. */
const COLLAPSED_SIZE: Size = { w: 140, h: 36 };
const PADDING = 24;
const LABEL_BAND = 18;

// ---------- The system ----------

export function registerContainers(system: Registry) {
  system('containers', (ctx) => {
    const { on, emit, contexts, graphs, selection, contribute, origin } = ctx;
    let next = 1;

    /** Per-graph state bucket — containers, the nesting helper, and the live
     *  item-store registration. Keyed by graph id so switching graphs hides
     *  others; deleting a graph drops its bucket. */
    type GraphState = {
      containers: Map<Id, Container>;
      nest: NestApi;
      storeOff: () => void;
    };
    const states = new Map<Id, GraphState>();
    const ensureState = (gid: Id): GraphState => {
      const existing = states.get(gid);
      if (existing) return existing;
      const containers = new Map<Id, Container>();
      const nest = createNesting<Container>({
        parents: containers,
        parentKind: 'container',
        onChange: id => emit('container.children.changed', { id }),
      });
      const graph = graphs.get(gid) ?? graphs.current;
      const storeOff = graph.registerItemStore<Container>('container', () => [...containers.values()]);
      const state: GraphState = { containers, nest, storeOff };
      states.set(gid, state);
      return state;
    };
    const stateOf = () => ensureState(graphs.current.id);
    const containersHere = () => stateOf().containers;
    const nestHere = () => stateOf().nest;
    let sectionTitleEdit: { containerId: Id; sectionId: Id } | null = null;
    let sectionResize: {
      containerId: Id;
      index: number;
      axis: SectionAxis;
      pointer: Position;
      rect: Rect;
      weights: number[];
    } | null = null;
    const containerOfChild = (childRef: ItemRef) => {
      const parent = nestHere().parentRefOf(childRef);
      return parent?.kind === 'container' ? containersHere().get(parent.id) ?? null : null;
    };
    const assignChildSection = (c: Container, childRef: ItemRef, sectionId?: Id) => {
      sanitizeContainerSections(c);
      if (!c.Sections?.length) return false;
      const valid = new Set(c.Sections.map(section => section.id));
      const next = sectionId && valid.has(sectionId) ? sectionId : firstSectionId(c);
      if (!next) return false;
      const key = refKey(childRef);
      const before = c.ChildSections?.[key];
      c.ChildSections = { ...(c.ChildSections ?? {}), [key]: next };
      return before !== next;
    };
    const removeChildSection = (childRef: ItemRef, parentId?: Id) => {
      const parents = parentId ? [containersHere().get(parentId)] : [...containersHere().values()];
      parents.forEach(c => {
        if (!c?.ChildSections) return;
        delete c.ChildSections[refKey(childRef)];
      });
    };
    const sectionTitleTarget = (target?: Element | null) => {
      const el = target?.closest('[data-container-section-title]') as HTMLElement | null;
      const containerId = el?.dataset.containerId ?? '';
      const sectionId = el?.dataset.sectionId ?? '';
      return el && containerId && sectionId ? { el, containerId, sectionId } : null;
    };
    const enterSectionTitleEdit = (el: HTMLElement) => {
      el.contentEditable = 'plaintext-only';
      el.classList.add('editing');
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    const exitSectionTitleEdit = (el: HTMLElement) => {
      el.contentEditable = 'inherit';
      el.classList.remove('editing');
    };

    on('graph.switched', () => { ensureState(graphs.current.id); });
    on('graph.deleted', ({ id }) => {
      const s = states.get(id);
      if (!s) return;
      s.storeOff();
      states.delete(id);
    });

    // Hierarchy + targets read live from the current graph's state — no
    // re-registration needed on switch.
    contexts.hierarchy.parents.register(origin, { parentRefOf: ref => stateOf().nest.parentRefOf(ref) });
    contexts.hierarchy.sources.register(origin, () => [...containersHere().values()].map(c => {
      const rect = visualRect(c);
      return {
        ref: { kind: 'container', id: c.id } as ItemRef,
        label: c.Label.text || c.id,
        // Anchor at the visual center so jump letters, picker, and view.fit.item
        // address the rendered rect — not the original drop position.
        anchor: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
      };
    }));

    // ---------- Auto-fit visual rect ----------
    const childBounds = (ref: ItemRef): Rect | null => {
      if (ref.kind === 'container') return visualRect(containersHere().get(ref.id) ?? null);
      return boundsOf(graphs.current.getItem(ref) as { Position?: Position; Size?: Size } ?? {}, { w: 80, h: 40 });
    };
    /** Is this container folded? Collapse is fold state (the `fold` store),
     *  not container data — same concept as outline/panel/zen folding. */
    const folded = (c: Container) => contexts.fold.folded(itemFoldId({ kind: 'container', id: c.id }, graphs.current.id));
    /** The expanded rect (children union + padding, or a default/manual box).
     *  Independent of fold state, so the folded badge can center on it. */
    const expandedRect = (c: Container): Rect => {
      if (c.AutoFit === false || c.Sections?.length) return boundsOf(c)!;
      const kids = c.Children.map(childBounds).filter((r): r is Rect => !!r);
      if (!kids.length) return boundsOf({ Position: c.Position, Size: DEFAULT_CONTAINER_SIZE })!;
      return expandRect(kids.reduce(unionRect), PADDING, LABEL_BAND);
    };
    const visualRect = (c: Container | null): Rect => {
      if (!c) return boundsOf({ Position: { x: 0, y: 0 }, Size: DEFAULT_CONTAINER_SIZE })!;
      // Folded → compact badge centered *live* on where the children are, so it
      // never jumps and uncollapse restores exactly (no stored position).
      if (folded(c)) return boundsOf({ Position: rectCenter(expandedRect(c)), Size: COLLAPSED_SIZE })!;
      return expandedRect(c);
    };

    // ---------- Entity declaration ----------
    const offEntity = ctx.model.registerEntity(createContainerEntity(visualRect, folded));
    const offCollection = ctx.model.registerCollection({
      id: 'containers',
      label: 'Containers',
      kind: 'container',
      items: () => [...containersHere().values()],
      toolbar: false,
      // No standalone outline section — containers appear nested in the unified
      // Outline tree alongside the nodes they group.
      section: false,
    });

    // ---------- Commands ----------
    contexts.commands.register([
      {
        id: 'editing.container.create',
        label: 'Create container',
        group: 'container',
        shortcut: 'Y',
        input: { on: 'keydown', key: 'y', prevent: true },
        payload: () => ({
          Label: { text: `Container ${containersHere().size + 1}` },
          at: contexts.view.spaceCenter(Places.Stage),
        }),
      },
      {
        id: 'graph.container.delete',
        label: 'Delete container',
        group: 'container',
        available: source => {
          const fromDom = !!source?.target?.closest('[data-item-kind="container"]') && !!itemIdFrom(source?.target);
          const ref = selection.selected();
          return fromDom || ref?.kind === 'container';
        },
        payload: source => {
          const fromDom = source.target?.closest('[data-item-kind="container"]')?.getAttribute('data-item-id');
          if (fromDom) return { id: fromDom };
          const ref = selection.selected();
          return ref?.kind === 'container' ? { id: ref.id } : undefined;
        },
      },
      {
        id: 'container.add-child',
        label: 'Move into container',
        group: 'container',
        shortcut: 'M',
        input: { on: 'keydown', key: 'm', prevent: true },
        picker: {
          title: 'Move into container',
          steps: [
            { id: 'child', prompt: 'Pick a node or container to move',
              filter: () => ref => ref.kind === 'node' || ref.kind === 'container',
              seed: () => {
                const r = selection.selected();
                return r && (r.kind === 'node' || r.kind === 'container') ? r : null;
              } },
            { id: 'container', prompt: 'Pick a container',
              filter: vs => ref => ref.kind === 'container' && !!vs.child && !nestHere().isAncestorOrSelf(vs.child, ref) },
          ],
          validate: vs => !containersHere().size ? 'Create a container first (Y).'
            : (!vs.child || !vs.container) ? 'Pick an item and a container.' : undefined,
          payload: vs => ({ containerId: vs.container.id, childRef: vs.child }),
        },
      },
      {
        id: 'container.remove-child',
        label: 'Remove from container',
        group: 'container',
        available: () => {
          const r = selection.selected();
          return !!r && !!nestHere().parentRefOf(r);
        },
        payload: () => {
          const r = selection.selected();
          return r ? { childRef: r } : undefined;
        },
      },
      {
        id: 'container.child.section.set',
        label: 'Move item to container section',
        group: 'container',
        hidden: true,
        payload: source => {
          const target = source.target as HTMLElement | undefined;
          const childKind = target?.dataset.childKind as ItemRef['kind'] | undefined;
          const childId = target?.dataset.childId;
          const childRef = childKind && childId ? { kind: childKind, id: childId } as ItemRef : selection.selected() ?? undefined;
          return {
            containerId: target?.dataset.containerId,
            childRef,
            sectionId: target?.dataset.sectionId,
          };
        },
      },
      {
        id: 'container.child.section.next',
        label: 'Move to next section',
        event: 'container.child.section.set',
        group: 'container',
        available: () => {
          const ref = selection.selected();
          const c = ref ? containerOfChild(ref) : null;
          return (c?.Sections?.length ?? 0) > 1;
        },
        payload: () => {
          const childRef = selection.selected() ?? undefined;
          const c = childRef ? containerOfChild(childRef) : null;
          if (!childRef || !c?.Sections?.length) return undefined;
          const current = c.ChildSections?.[refKey(childRef)] ?? firstSectionId(c);
          const index = Math.max(0, c.Sections.findIndex(section => section.id === current));
          return { containerId: c.id, childRef, sectionId: c.Sections[(index + 1) % c.Sections.length].id };
        },
      },
      {
        id: 'container.section.title.edit.dblclick',
        label: 'Edit section title',
        event: 'container.section.title.edit',
        group: 'container',
        hidden: true,
        input: { on: 'dblclick', selector: '[data-container-section-title]', prevent: true, stop: true },
        payload: ({ target }) => {
          const hit = sectionTitleTarget(target);
          return hit ? { containerId: hit.containerId, sectionId: hit.sectionId } : undefined;
        },
      },
      {
        id: 'container.section.title.commit.enter',
        label: 'Commit section title',
        event: 'container.section.title.commit',
        group: 'container',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', selector: '[data-container-section-title].editing', prevent: true, stop: true },
        payload: ({ target }) => {
          const hit = sectionTitleTarget(target);
          return hit ? { containerId: hit.containerId, sectionId: hit.sectionId, title: hit.el.textContent?.trim() ?? '', finish: true } : undefined;
        },
      },
      {
        id: 'container.section.title.commit.focusout',
        label: 'Commit section title on blur',
        event: 'container.section.title.commit',
        group: 'container',
        hidden: true,
        input: { on: 'focusout', selector: '[data-container-section-title].editing' },
        payload: ({ target }) => {
          const hit = sectionTitleTarget(target);
          return hit ? { containerId: hit.containerId, sectionId: hit.sectionId, title: hit.el.textContent?.trim() ?? '' } : undefined;
        },
      },
      {
        id: 'container.section.resize.start',
        label: 'Start section resize',
        group: 'container',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-container-section-resize]', prevent: true, stop: true },
        payload: ({ event, target }) => ({
          containerId: (target as HTMLElement).dataset.containerId ?? '',
          index: Number((target as HTMLElement).dataset.sectionIndex ?? 0),
          x: (event as PointerEvent).clientX,
          y: (event as PointerEvent).clientY,
        }),
      },
      {
        id: 'container.section.resize.move',
        label: 'Resize sections',
        group: 'container',
        hidden: true,
        input: { on: 'pointermove', when: () => !!sectionResize, prevent: true, stop: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      {
        id: 'container.section.resize.end',
        label: 'End section resize',
        group: 'container',
        hidden: true,
        input: { on: 'pointerup', when: () => !!sectionResize, stop: true },
      },
    ]);

    // ---------- Handlers ----------
    on('editing.container.create', draft => {
      const id = `c${next++}`;
      containersHere().set(id, {
        id, kind: 'container',
        Label: draft.Label ?? { text: id },
        Position: draft.at ?? { x: 0, y: 0 },
        Size: { ...DEFAULT_CONTAINER_SIZE },
        Sections: [],
        SectionAxis: 'rows',
        ChildSections: {},
        Children: [],
      });
      emit('container.created', { id });
      emit('selection.item.select', { kind: 'container', id });
    });
    on('container.import.snapshot', ({ containers }) => {
      const here = containersHere();
      const nest = nestHere();
      [...here.values()].forEach(c => c.Children.forEach(child => nest.remove(child)));
      here.clear();
      containers.forEach(input => {
        here.set(input.id, {
          id: input.id,
          kind: 'container',
          Label: { text: input.label },
          Position: { x: 0, y: 0 },
          Size: { ...DEFAULT_CONTAINER_SIZE },
          AutoFit: true,
          Sections: [],
          SectionAxis: 'rows',
          ChildSections: {},
          Children: [],
        });
        input.children.forEach(id => nest.add(input.id, { kind: 'node', id }));
        emit('container.created', { id: input.id });
      });
      emit('selection.item.clear');
    });
    on('graph.container.delete', ({ id }) => {
      const here = containersHere();
      const nest = nestHere();
      const c = here.get(id);
      if (!c) return;
      // Delete owned children before deleting this container. Nested containers
      // recurse through the same owner event; nodes use graph.node.delete so
      // graph.ts still owns node/incident-edge cleanup.
      [...c.Children].forEach(childRef => {
        if (childRef.kind === 'container') emit('graph.container.delete', { id: childRef.id });
        else if (childRef.kind === 'node') emit('graph.node.delete', { id: childRef.id });
        else nest.remove(childRef);
      });
      // If this container was nested, detach from its own parent.
      nest.remove({ kind: 'container', id });
      here.delete(id);
      emit('container.deleted', { id });
    });
    on('container.add-child', ({ containerId, childRef, sectionId }) => {
      // Verify the child exists in some store before nesting it.
      if (!graphs.current.getItem(childRef)) return;
      const result = nestHere().add(containerId, childRef);
      const c = containersHere().get(containerId);
      const sectionChanged = c ? assignChildSection(c, childRef, sectionId) : false;
      if (result === 'cycle') emit('app.notice', { message: 'Cannot nest a container into its own descendant.', level: 'warn' });
      else if (sectionChanged) {
        emit('container.children.changed', { id: containerId });
        emit('container.updated', { id: containerId });
      }
    });
    on('container.remove-child', ({ childRef }) => {
      const parentId = nestHere().remove(childRef);
      removeChildSection(childRef, parentId);
    });
    on('container.child.section.set', ({ containerId, childRef, sectionId }) => {
      if (!childRef) return;
      const c = containerId ? containersHere().get(containerId) ?? null : containerOfChild(childRef);
      if (!c || !sectionId) return;
      if (assignChildSection(c, childRef, sectionId)) {
        emit('container.children.changed', { id: c.id });
        emit('container.updated', { id: c.id });
      }
    });
    on('container.section.title.edit', ({ containerId, sectionId }) => queueMicrotask(() => {
      const el = contexts.places.el(Places.Stage)
        ?.querySelector(`[data-container-section-title][data-container-id="${containerId}"][data-section-id="${sectionId}"]`);
      if (!(el instanceof HTMLElement)) return;
      sectionTitleEdit = { containerId, sectionId };
      enterSectionTitleEdit(el);
    }));
    on('container.section.title.commit', ({ containerId, sectionId, title, finish }) => {
      const c = containersHere().get(containerId);
      const section = c?.Sections?.find(candidate => candidate.id === sectionId);
      if (!c || !section) return;
      const next = title || section.title;
      if (section.title !== next) {
        section.title = next;
        emit('container.updated', { id: c.id });
      }
      const el = contexts.places.el(Places.Stage)
        ?.querySelector(`[data-container-section-title][data-container-id="${containerId}"][data-section-id="${sectionId}"]`);
      if (el instanceof HTMLElement) {
        el.textContent = section.title;
        exitSectionTitleEdit(el);
        if (finish) queueMicrotask(() => el.blur());
      }
      if (sectionTitleEdit?.containerId === containerId && sectionTitleEdit.sectionId === sectionId) sectionTitleEdit = null;
    });
    on('container.section.resize.start', ({ containerId, index, x, y }) => {
      const c = containersHere().get(containerId);
      if (!c?.Sections || index < 0 || index >= c.Sections.length - 1) return;
      const rect = visualRect(c);
      sectionResize = {
        containerId,
        index,
        axis: c.SectionAxis ?? 'rows',
        pointer: contexts.view.clientToSpace(Places.Stage, { x, y }),
        rect,
        weights: c.Sections.map(section => Math.max(0.15, section.weight ?? 1)),
      };
    });
    on('container.section.resize.move', ({ x, y }) => {
      if (!sectionResize) return;
      const c = containersHere().get(sectionResize.containerId);
      if (!c?.Sections) return;
      const pointer = contexts.view.clientToSpace(Places.Stage, { x, y });
      const size = sectionResize.axis === 'columns' ? sectionResize.rect.w : sectionResize.rect.h;
      const deltaPx = sectionResize.axis === 'columns'
        ? pointer.x - sectionResize.pointer.x
        : pointer.y - sectionResize.pointer.y;
      const total = sectionResize.weights.reduce((sum, weight) => sum + weight, 0);
      const deltaWeight = size > 0 ? (deltaPx / size) * total : 0;
      const next = [...sectionResize.weights];
      const a = sectionResize.index;
      const b = a + 1;
      const min = 0.15;
      const applied = Math.max(min - next[a], Math.min(deltaWeight, next[b] - min));
      next[a] += applied;
      next[b] -= applied;
      c.Sections = c.Sections.map((section, i) => ({ ...section, weight: next[i] ?? section.weight ?? 1 }));
      emit('container.updated', { id: c.id });
      emit('container.children.changed', { id: c.id });
    });
    on('container.section.resize.end', () => { sectionResize = null; });
    on('graph.node.deleted', ({ id }) => {
      const ref = { kind: 'node', id } as ItemRef;
      const parentId = nestHere().remove(ref);
      removeChildSection(ref, parentId);
    });
    on('selection.item.delete', () => {
      // Delete every chosen container (containers owns its kind; selectable owns
      // node/edge). Fan-out over the set — same command for 1 or N.
      selection.selectedAll().forEach(ref => {
        if (ref.kind === 'container') emit('graph.container.delete', { id: ref.id });
      });
    });

    // ---------- Storage: apply container patches from item.update ----------
    contexts.storage.register('container', origin, (ref, patch) => {
      const c = containersHere().get(ref.id);
      if (!c) return;
      const p = patch as ContainerPatch;
      const oldPos = { ...c.Position };
      Object.assign(c, p);
      if (p.Sections || p.SectionAxis || p.ChildSections) sanitizeContainerSections(c);
      // Drag cascade: when the container moves, children move with it.
      if (p.Position && (p.Position.x !== oldPos.x || p.Position.y !== oldPos.y)) {
        const dx = p.Position.x - oldPos.x;
        const dy = p.Position.y - oldPos.y;
        c.Children.forEach(childRef => {
          const child = graphs.current.getItem(childRef) as { Position?: Position } | undefined;
          if (!child?.Position) return;
          emit('item.update', { ref: childRef, patch: { Position: { x: child.Position.x + dx, y: child.Position.y + dy } } });
        });
      }
      emit('container.updated', { id: c.id });
      if (p.Sections || p.SectionAxis || p.ChildSections) emit('container.children.changed', { id: c.id });
    });

    contribute({ surface: 'top', command: 'editing.container.create', kind: 'button', text: '+ Container', order: 17, group: 'edit' });

    return () => {
      offEntity();
      offCollection();
      states.forEach(s => s.storeOff());
      states.clear();
    };
  }, { requires: ['render.stage', 'graph'] });
}
