import { itemIdFrom, type Registry } from '../core';
import { Places } from '../types';
import type { EntityDef, EntityRenderer, Id, ItemRef, Position, Rect, Size } from '../types';

/**
 * Container system — the single-file mental test.
 *
 * Demonstrates that adding a brand-new nested item kind requires no edits to:
 *   - core.ts, types.ts (extension via declare module + CustomItemKinds)
 *   - model/app.ts, model/entities.ts (runtime registerEntity / registerCollection)
 *   - render-stage.ts, layout.ts, selectable.ts, focus.ts, jump.ts
 *     (all already work over ItemRef + hierarchy)
 *
 * What this file owns:
 *   1. Container kind + events (declare module).
 *   2. Container data + a Map-backed store.
 *   3. Entity declaration + HTML renderer + collection registration.
 *   4. Hierarchy provider — "this node lives in container X".
 *   5. itemTargets provider — containers appear in jump/picker.
 *   6. Commands: create, delete, move-into (picker), remove-from.
 *   7. Listeners for graph.node.deleted (cleanup) and selection.item.delete
 *      (delete via X when a container is selected).
 *   8. Toolbar button.
 */

declare module '../types' {
  interface CustomItemKinds {
    container: unknown;
  }
  interface CustomEvents {
    'editing.container.create': { Label?: { text: string }; at?: Position };
    'container.created': { id: Id };
    'graph.container.delete': { id: Id };
    'container.deleted': { id: Id };
    'container.add-child': { containerId: Id; nodeId: Id };
    'container.remove-child': { nodeId: Id };
    'container.children.changed': { id: Id };
  }
}

type Container = {
  id: Id;
  kind: 'container';
  Label: { text: string };
  Position: Position;
  Size: Size;
  Children: Id[];
};

const DEFAULT_SIZE: Size = { w: 320, h: 200 };

export function registerContainers(system: Registry) {
  system('containers', (ctx) => {
    const { on, emit, contexts, graphs, selection, contribute, origin } = ctx;
    let next = 1;
    const containers = new Map<Id, Container>();
    const containerOfNode = new Map<Id, Id>();

    // Register an item store on the current graph (and on every future graph) so
    // graph.itemsOfKind('container') / graph.getItem({kind:'container', id}) resolve through us.
    const storeProvider = () => [...containers.values()];
    let storeOff = graphs.current.registerItemStore<Container>('container', storeProvider);
    on('graph.switched', () => {
      storeOff();
      storeOff = graphs.current.registerItemStore<Container>('container', storeProvider);
    });

    // Hierarchy provider — the seam that makes layout/render/selection nested-aware.
    contexts.hierarchy.register(origin, {
      parentRefOf: (ref) => {
        if (ref.kind !== 'node') return undefined;
        const cid = containerOfNode.get(ref.id);
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
        const ref = rctx.refOf(c.id);
        rctx.tagItem(el, ref);
        rctx.applyItemModes(el, ref);
        const label = document.createElement('div');
        label.className = 'container-label';
        label.textContent = c.Label.text;
        el.append(label);
        return el;
      },
    };
    const containerEntity: EntityDef<Container> = {
      kind: 'container',
      label: 'Container',
      labelOf: c => c.Label.text || c.id,
      // Paint behind nodes/edges. Other kinds default to 0 — containers go first.
      order: -10,
      // V1: no per-entity abilities. selection.item.select catches pointer-down on
      // any [data-item-kind][data-item-id], and we wire delete-by-X below. Drag /
      // edit / configurable land in v2.
      abilities: [],
    };
    containerEntity.render = containerRenderer;
    const offEntity = ctx.model.registerEntity(containerEntity);
    const offCollection = ctx.model.registerCollection({
      id: 'containers',
      label: 'Containers',
      kind: 'container',
      items: () => [...containers.values()],
      toolbar: false, // We contribute our own toolbar button below so order is explicit.
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
          const ref = source?.target ? null : selection.selected();
          return (itemIdFrom(source?.target) && source?.target?.closest('[data-item-kind="container"]') != null)
            || ref?.kind === 'container';
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
        label: 'Move node into container',
        event: 'container.add-child',
        group: 'container',
        shortcut: 'M',
        input: { on: 'keydown', key: 'm', prevent: true },
        picker: {
          title: 'Move into container',
          steps: [
            {
              id: 'node',
              prompt: 'Pick a node',
              filter: () => ref => ref.kind === 'node',
              seed: () => {
                const r = selection.selected();
                return r?.kind === 'node' ? r : null;
              },
            },
            {
              id: 'container',
              prompt: 'Pick a container',
              filter: () => ref => ref.kind === 'container',
            },
          ],
          validate: values => {
            if (!containers.size) return 'Create a container first (Y).';
            if (!values.node || !values.container) return 'Pick a node and a container.';
            return undefined;
          },
          payload: values => ({ containerId: values.container.id, nodeId: values.node.id }),
        },
      },
      {
        id: 'container.remove-child',
        label: 'Remove node from container',
        event: 'container.remove-child',
        group: 'container',
        available: () => {
          const r = selection.selected();
          return r?.kind === 'node' && containerOfNode.has(r.id);
        },
        payload: () => {
          const r = selection.selected();
          return r?.kind === 'node' ? { nodeId: r.id } : undefined;
        },
      },
    ]);

    // ----- Handlers -----
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
      // Select the new container so X deletes it / M opens picker etc.
      emit('selection.item.select', { kind: 'container', id });
    });
    on('graph.container.delete', ({ id }) => {
      const c = containers.get(id);
      if (!c) return;
      // Release children — they keep their position but lose the parent link.
      c.Children.forEach(cid => containerOfNode.delete(cid));
      containers.delete(id);
      emit('container.deleted', { id });
    });
    on('container.add-child', ({ containerId, nodeId }) => {
      const c = containers.get(containerId);
      if (!c || !graphs.current.getNode(nodeId)) return;
      const prev = containerOfNode.get(nodeId);
      if (prev && prev !== containerId) {
        const prevC = containers.get(prev);
        if (prevC) prevC.Children = prevC.Children.filter(x => x !== nodeId);
        emit('container.children.changed', { id: prev });
      }
      if (!c.Children.includes(nodeId)) c.Children.push(nodeId);
      containerOfNode.set(nodeId, containerId);
      emit('container.children.changed', { id: containerId });
    });
    on('container.remove-child', ({ nodeId }) => {
      const cid = containerOfNode.get(nodeId);
      if (!cid) return;
      const c = containers.get(cid);
      if (c) c.Children = c.Children.filter(x => x !== nodeId);
      containerOfNode.delete(nodeId);
      emit('container.children.changed', { id: cid });
    });
    // Cleanup: if a node is deleted, drop it from any container it lived in.
    on('graph.node.deleted', ({ id }) => {
      const cid = containerOfNode.get(id);
      if (!cid) return;
      const c = containers.get(cid);
      if (c) c.Children = c.Children.filter(x => x !== id);
      containerOfNode.delete(id);
      emit('container.children.changed', { id: cid });
    });
    // X deletes the selected item — selectable.ts handles node/edge; we cover container.
    on('selection.item.delete', () => {
      const ref = selection.selected();
      if (ref?.kind === 'container') emit('graph.container.delete', { id: ref.id });
    });

    // Toolbar button. We disabled the collection's auto-toolbar above so we own ordering.
    contribute({ surface: 'top', command: 'editing.container.create', kind: 'button', text: '+ Container', order: 17 });

    // Teardown when the system is disabled.
    return () => {
      offEntity();
      offCollection();
      storeOff();
    };
  });
}
