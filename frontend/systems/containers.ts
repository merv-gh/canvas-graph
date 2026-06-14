import { collapsible, configurable, draggable, editable, nudgeable, resizeable, selectable } from '../abilities';
import { boundsOf, createNesting, expandRect, itemFoldId, itemIdFrom, rectCenter, unionRect, type NestApi, type Registry } from '../core';
import { Places, Slots } from '../types';
import type {
  EntityDef,
  EntityRenderer,
  Id,
  ItemRef,
  Position,
  PropertyDef,
  Rect,
  Size,
} from '../types';

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
    'container.add-child': { containerId: Id; childRef: ItemRef };
    'container.remove-child': { childRef: ItemRef };
    'container.children.changed': { id: Id };
  }
}

type Container = {
  id: Id;
  kind: 'container';
  Label: { text: string };
  Position: Position;
  Size: Size;
  /** Default true: visual rect is auto-fit from children. Manual resize flips this. */
  AutoFit?: boolean;
  Sections?: { id: Id; title: string }[];
  Children: ItemRef[];
};
type ContainerPatch = Partial<Pick<Container, 'Label' | 'Position' | 'Size' | 'AutoFit' | 'Sections'>>;

const DEFAULT_SIZE: Size = { w: 320, h: 200 };
/** Compact size used when collapsed — just enough room for the label badge. */
const COLLAPSED_SIZE: Size = { w: 140, h: 36 };
const PADDING = 24;
const LABEL_BAND = 18;
const parseSections = (value: unknown) =>
  String(value)
    .split(/\r?\n/)
    .map(title => title.trim())
    .filter(Boolean)
    .map((title, index) => ({ id: `s${index + 1}`, title }));

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
      if (c.AutoFit === false) return boundsOf(c)!;
      const kids = c.Children.map(childBounds).filter((r): r is Rect => !!r);
      if (!kids.length) return boundsOf({ Position: c.Position, Size: DEFAULT_SIZE })!;
      return expandRect(kids.reduce(unionRect), PADDING, LABEL_BAND);
    };
    const visualRect = (c: Container | null): Rect => {
      if (!c) return boundsOf({ Position: { x: 0, y: 0 }, Size: DEFAULT_SIZE })!;
      // Folded → compact badge centered *live* on where the children are, so it
      // never jumps and uncollapse restores exactly (no stored position).
      if (folded(c)) return boundsOf({ Position: rectCenter(expandedRect(c)), Size: COLLAPSED_SIZE })!;
      return expandedRect(c);
    };

    // ---------- Entity declaration ----------
    const render: EntityRenderer<Container> = {
      layer: 'html',
      bounds: visualRect,
      draw(c, r) {
        const rect = visualRect(c);
        const el = document.createElement('div');
        el.className = 'container';
        if (folded(c)) el.classList.add('collapsed');
        if (c.AutoFit === false) el.classList.add('manual');
        el.style.left = `${rect.x + rect.w / 2}px`;
        el.style.top = `${rect.y + rect.h / 2}px`;
        el.style.width = `${rect.w}px`;
        el.style.height = `${rect.h}px`;
        const ref = r.refOf(c.id);
        r.tagItem(el, ref);
        r.applyItemModes(el, ref);
        if (!folded(c) && c.Sections?.length) {
          el.classList.add('has-sections');
          const sections = document.createElement('div');
          sections.className = 'container-sections';
          c.Sections.forEach(section => {
            const band = document.createElement('div');
            band.className = 'container-section';
            const title = document.createElement('span');
            title.textContent = section.title;
            band.append(title);
            sections.append(band);
          });
          el.append(sections);
        }
        // Editable label (data-editable-title triggers the generic edit flow).
        const label = document.createElement('div');
        label.className = 'container-label';
        label.dataset.editableTitle = '';
        label.textContent = c.Label.text;
        // Resize handle slot — wireAffordances injects data-resize-handle.
        const handle = document.createElement('div');
        handle.className = 'container-resize';
        handle.dataset.slot = Slots.Resize;
        el.append(label, handle);
        r.wireAffordances(el);
        return el;
      },
    };

    const properties: PropertyDef<Container, ContainerPatch>[] = [
      { id: 'title', label: 'Title', input: 'text',
        value: c => c.Label.text,
        patch: (_c, v) => ({ Label: { text: String(v) } }) },
      { id: 'width', label: 'Width', input: 'number', min: 120, step: 8,
        value: c => c.Size.w,
        patch: (c, v) => Number.isFinite(Number(v)) ? { Size: { ...c.Size, w: Math.max(120, Number(v)) } } : undefined },
      { id: 'height', label: 'Height', input: 'number', min: 80, step: 8,
        value: c => c.Size.h,
        patch: (c, v) => Number.isFinite(Number(v)) ? { Size: { ...c.Size, h: Math.max(80, Number(v)) } } : undefined },
      { id: 'sections', label: 'Sections', input: 'textarea', rows: 4, group: 'Structure',
        value: c => c.Sections?.map(s => s.title).join('\n') ?? '',
        patch: (_c, v) => ({ Sections: parseSections(v) }) },
    ];

    const entity: EntityDef<Container, ContainerPatch> = {
      kind: 'container',
      label: 'Container',
      labelOf: c => c.Label.text || c.id,
      order: -10, // Paint behind nodes/edges.
      // All 7 abilities — container satisfies every structural shape.
      abilities: [
        selectable<Container>(),
        draggable<Container>(),
        nudgeable<Container>(),
        editable<Container>(),
        collapsible<Container>(),
        configurable<Container>(),
        resizeable<Container>(),
      ],
      properties,
      render,
    };
    const offEntity = ctx.model.registerEntity(entity);
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
    ]);

    // ---------- Handlers ----------
    on('editing.container.create', draft => {
      const id = `c${next++}`;
      containersHere().set(id, {
        id, kind: 'container',
        Label: draft.Label ?? { text: id },
        Position: draft.at ?? { x: 0, y: 0 },
        Size: { ...DEFAULT_SIZE },
        Sections: [],
        Children: [],
      });
      emit('container.created', { id });
      emit('selection.item.select', { kind: 'container', id });
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
    on('container.add-child', ({ containerId, childRef }) => {
      // Verify the child exists in some store before nesting it.
      if (!graphs.current.getItem(childRef)) return;
      const result = nestHere().add(containerId, childRef);
      if (result === 'cycle') emit('app.notice', { message: 'Cannot nest a container into its own descendant.', level: 'warn' });
    });
    on('container.remove-child', ({ childRef }) => { nestHere().remove(childRef); });
    on('graph.node.deleted', ({ id }) => { nestHere().remove({ kind: 'node', id }); });
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
    });

    contribute({ surface: 'top', command: 'editing.container.create', kind: 'button', text: '+ Container', order: 17 });

    return () => {
      offEntity();
      offCollection();
      states.forEach(s => s.storeOff());
      states.clear();
    };
  }, { requires: ['render.stage', 'graph'] });
}
