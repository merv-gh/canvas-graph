import { collapsible, configurable, draggable, editable, nudgeable, selectable } from '../abilities';
import { itemIdFrom, itemRefFrom, type Registry } from '../core';
import { Places } from '../types';
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
 * Container system — the single-file mental test, v2.
 *
 * What this file owns:
 *   1. Container kind + events (declare module).
 *   2. Container data + a Map-backed store.
 *   3. Entity declaration with abilities (selectable, draggable, nudgeable,
 *      editable, collapsible, configurable) — works because all those
 *      abilities have *structural* generic constraints now.
 *   4. HTML renderer with [data-editable-title] for editable + wireAffordances
 *      for in-template chrome.
 *   5. Hierarchy provider — "this item lives in container X".
 *   6. itemTargets provider — containers appear in jump/picker.
 *   7. Collection registration + toolbar button.
 *   8. Commands: create, delete, move-into (picker), remove-from.
 *   9. item.update listener for kind:'container' (storage handler).
 *  10. Listeners for graph.node.deleted (cleanup) + selection.item.delete
 *      (delete via X when a container is selected).
 *  11. Drag cascade: when a container moves, its children move with it.
 */

declare module '../types' {
  interface CustomItemKinds {
    container: unknown;
  }
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
  Collapsed?: boolean;
  /** Refs of nested items (nodes or other containers). Storing refs (not just
   *  ids) keeps the kind around so the resolver doesn't have to probe stores. */
  Children: ItemRef[];
};

type ContainerPatch = Partial<Pick<Container, 'Label' | 'Position' | 'Size' | 'Collapsed'>>;

const DEFAULT_SIZE: Size = { w: 320, h: 200 };
const PARENT_KEY = (ref: ItemRef) => `${ref.kind}:${ref.id}`;

export function registerContainers(system: Registry) {
  system('containers', (ctx) => {
    const { on, emit, contexts, graphs, selection, contribute, origin } = ctx;
    let next = 1;
    const containers = new Map<Id, Container>();
    /** Item → parent container. Keyed by `kind:id` so node "e1" and container
     *  "e1" don't collide if both ever exist. Walked by hierarchy.parentRefOf. */
    const parentOf = new Map<string, Id>();

    // Register an item store on the current graph (and on every future graph) so
    // graph.itemsOfKind('container') / graph.getItem({kind:'container', id}) work.
    const storeProvider = () => [...containers.values()];
    let storeOff = graphs.current.registerItemStore<Container>('container', storeProvider);
    on('graph.switched', () => {
      storeOff();
      storeOff = graphs.current.registerItemStore<Container>('container', storeProvider);
    });

    // Hierarchy provider — the seam that makes layout/render/selection nested-aware.
    contexts.hierarchy.register(origin, {
      parentRefOf: (ref) => {
        const cid = parentOf.get(PARENT_KEY(ref));
        return cid && containers.has(cid) ? { kind: 'container' as const, id: cid } : undefined;
      },
    });

    // Jump / picker targets.
    contexts.itemTargets.register(origin, () => [...containers.values()].map(c => ({
      ref: { kind: 'container', id: c.id } as ItemRef,
      label: c.Label.text || c.id,
      anchor: c.Position,
    })));

    // ----- Entity declaration -----
    const containerBounds = (c: Container): Rect => ({
      x: c.Position.x - c.Size.w / 2,
      y: c.Position.y - c.Size.h / 2,
      w: c.Size.w,
      h: c.Size.h,
    });
    const containerRenderer: EntityRenderer<Container> = {
      layer: 'html',
      bounds: containerBounds,
      draw(c, rctx) {
        const el = document.createElement('div');
        el.className = 'container';
        el.style.left = `${c.Position.x}px`;
        el.style.top = `${c.Position.y}px`;
        el.style.width = `${c.Size.w}px`;
        el.style.height = `${c.Size.h}px`;
        if (c.Collapsed) el.classList.add('collapsed');
        const ref = rctx.refOf(c.id);
        rctx.tagItem(el, ref);
        rctx.applyItemModes(el, ref);
        // Editable label — [data-editable-title] is the generic selector
        // editable's commands hook on. Single click selects (via global
        // pointer handler); double-click enters edit mode.
        const label = document.createElement('div');
        label.className = 'container-label';
        label.dataset.editableTitle = '';
        label.textContent = c.Label.text;
        el.append(label);
        // Container's in-DOM affordance slots are empty in v1: chrome
        // (drag, collapse, configure) lives in the floating item-toolbar.
        // wireAffordances stays a no-op here — it's safe to call.
        rctx.wireAffordances(el);
        return el;
      },
    };

    const containerProperties: PropertyDef<Container, ContainerPatch>[] = [
      {
        id: 'title',
        label: 'Title',
        input: 'text',
        value: c => c.Label.text,
        patch: (_c, value) => ({ Label: { text: String(value) } }),
      },
      {
        id: 'width',
        label: 'Width',
        input: 'number',
        min: 120,
        step: 8,
        value: c => c.Size.w,
        patch: (c, value) => {
          const w = Number(value);
          return Number.isFinite(w) ? { Size: { ...c.Size, w: Math.max(120, w) } } : undefined;
        },
      },
      {
        id: 'height',
        label: 'Height',
        input: 'number',
        min: 80,
        step: 8,
        value: c => c.Size.h,
        patch: (c, value) => {
          const h = Number(value);
          return Number.isFinite(h) ? { Size: { ...c.Size, h: Math.max(80, h) } } : undefined;
        },
      },
      {
        id: 'collapsed',
        label: 'Collapsed',
        input: 'checkbox',
        value: c => !!c.Collapsed,
        patch: (_c, value) => ({ Collapsed: !!value }),
      },
    ];

    const containerEntity: EntityDef<Container, ContainerPatch> = {
      kind: 'container',
      label: 'Container',
      labelOf: c => c.Label.text || c.id,
      // Paint behind nodes/edges. Other kinds default to 0 — containers go first.
      order: -10,
      // Container has all the structural shapes these abilities need:
      // Identified (selectable, configurable), Positioned (draggable,
      // nudgeable), Labeled (editable), Collapsable (collapsible).
      abilities: [
        selectable<Container>(),
        draggable<Container>(),
        nudgeable<Container>(),
        editable<Container>(),
        collapsible<Container>(),
        configurable<Container>(),
      ],
      properties: containerProperties,
      render: containerRenderer,
    };
    const offEntity = ctx.model.registerEntity(containerEntity);
    const offCollection = ctx.model.registerCollection({
      id: 'containers',
      label: 'Containers',
      kind: 'container',
      items: () => [...containers.values()],
      toolbar: false,
    });

    // ----- Commands -----
    contexts.commands.register([
      {
        id: 'editing.container.create',
        label: 'Create container',
        event: 'editing.container.create',
        group: 'container',
        shortcut: 'Y',
        input: { on: 'keydown', key: 'y', prevent: true },
        payload: () => ({
          Label: { text: `Container ${containers.size + 1}` },
          at: contexts.view.spaceCenter(Places.Stage),
        }),
      },
      {
        id: 'graph.container.delete',
        label: 'Delete container',
        event: 'graph.container.delete',
        group: 'container',
        available: source => {
          const fromDom = source?.target?.closest('[data-item-kind="container"]') != null
            && !!itemIdFrom(source?.target);
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
        event: 'container.add-child',
        group: 'container',
        shortcut: 'M',
        input: { on: 'keydown', key: 'm', prevent: true },
        picker: {
          title: 'Move into container',
          steps: [
            {
              id: 'child',
              prompt: 'Pick a node or container to move',
              // Anything but edges (which have no Position) and unnested
              // collections can be a child.
              filter: () => ref => ref.kind === 'node' || ref.kind === 'container',
              seed: () => {
                const r = selection.selected();
                return r && (r.kind === 'node' || r.kind === 'container') ? r : null;
              },
            },
            {
              id: 'container',
              prompt: 'Pick a container',
              filter: values => ref => {
                if (ref.kind !== 'container') return false;
                // Cycle guard: can't move a container into itself or any descendant.
                const child = values.child;
                if (!child) return true;
                if (child.kind === 'container' && child.id === ref.id) return false;
                // Walk up the target's parent chain; refuse if the child appears.
                let cur: ItemRef | undefined = ref;
                const seen = new Set<string>();
                while (cur) {
                  const key = PARENT_KEY(cur);
                  if (seen.has(key)) break;
                  seen.add(key);
                  if (child.kind === cur.kind && child.id === cur.id) return false;
                  const parentId = parentOf.get(key);
                  cur = parentId ? { kind: 'container', id: parentId } : undefined;
                }
                return true;
              },
            },
          ],
          validate: values => {
            if (!containers.size) return 'Create a container first (Y).';
            if (!values.child || !values.container) return 'Pick an item and a container.';
            return undefined;
          },
          payload: values => ({ containerId: values.container.id, childRef: values.child }),
        },
      },
      {
        id: 'container.remove-child',
        label: 'Remove from container',
        event: 'container.remove-child',
        group: 'container',
        available: () => {
          const r = selection.selected();
          return !!r && parentOf.has(PARENT_KEY(r));
        },
        payload: () => {
          const r = selection.selected();
          return r ? { childRef: r } : undefined;
        },
      },
    ]);

    // ----- Handlers -----

    const removeChildFromCurrentParent = (childRef: ItemRef) => {
      const key = PARENT_KEY(childRef);
      const prev = parentOf.get(key);
      if (!prev) return;
      const c = containers.get(prev);
      if (c) c.Children = c.Children.filter(r => !(r.kind === childRef.kind && r.id === childRef.id));
      parentOf.delete(key);
      emit('container.children.changed', { id: prev });
    };

    on('editing.container.create', draft => {
      const id = `c${next++}`;
      const container: Container = {
        id,
        kind: 'container',
        Label: draft.Label ?? { text: id },
        Position: draft.at ?? { x: 0, y: 0 },
        Size: { ...DEFAULT_SIZE },
        Children: [],
      };
      containers.set(id, container);
      emit('container.created', { id });
      emit('selection.item.select', { kind: 'container', id });
    });
    on('graph.container.delete', ({ id }) => {
      const c = containers.get(id);
      if (!c) return;
      // Release children — they keep their position but lose the parent link.
      c.Children.forEach(childRef => parentOf.delete(PARENT_KEY(childRef)));
      // If this container itself was nested, drop it from its parent's Children.
      removeChildFromCurrentParent({ kind: 'container', id });
      containers.delete(id);
      emit('container.deleted', { id });
    });
    on('container.add-child', ({ containerId, childRef }) => {
      const c = containers.get(containerId);
      if (!c) return;
      // Verify the child exists in its claimed store.
      const childItem = graphs.current.getItem(childRef);
      if (!childItem) return;
      // Detach from previous parent (if any, and not the same target).
      const key = PARENT_KEY(childRef);
      const prevId = parentOf.get(key);
      if (prevId === containerId) return;
      if (prevId) {
        const prev = containers.get(prevId);
        if (prev) prev.Children = prev.Children.filter(r => !(r.kind === childRef.kind && r.id === childRef.id));
        emit('container.children.changed', { id: prevId });
      }
      if (!c.Children.some(r => r.kind === childRef.kind && r.id === childRef.id)) c.Children.push(childRef);
      parentOf.set(key, containerId);
      emit('container.children.changed', { id: containerId });
    });
    on('container.remove-child', ({ childRef }) => {
      removeChildFromCurrentParent(childRef);
    });
    // Cleanup: if a node is removed from the graph, drop it from any container.
    on('graph.node.deleted', ({ id }) => {
      removeChildFromCurrentParent({ kind: 'node', id });
    });
    // X deletes the selected item — selectable handles node/edge; we cover container.
    on('selection.item.delete', () => {
      const ref = selection.selected();
      if (ref?.kind === 'container') emit('graph.container.delete', { id: ref.id });
    });

    // ----- Storage handler: apply container patches from item.update -----

    on('item.update', ({ ref, patch }) => {
      if (ref.kind !== 'container') return;
      const c = containers.get(ref.id);
      if (!c) return;
      const p = patch as ContainerPatch;
      const oldPos = { ...c.Position };
      Object.assign(c, p);
      // Drag cascade: if the container moved, its children move with it.
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

    // Toolbar button. We disabled the collection's auto-toolbar above so we own ordering.
    contribute({ surface: 'top', command: 'editing.container.create', kind: 'button', text: '+ Container', order: 17 });

    return () => {
      offEntity();
      offCollection();
      storeOff();
    };
  });
}
