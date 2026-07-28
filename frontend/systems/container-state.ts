import { createNesting, type NestApi, type SystemCtx } from '../core';
import type { Id } from '../types';
import {
  sanitizeContainerSections,
  sanitizeLegend,
  type Container,
} from './container-entity';

type ContainerSnapshot = Omit<Container, 'kind'>;

type ContainerStateDependencies = {
  emit: SystemCtx['emit'];
  graphs: SystemCtx['graphs'];
};

export const createContainerStates = ({ emit, graphs }: ContainerStateDependencies) => {
    let next = 1;
    /** Per-graph state bucket — containers, the nesting helper, and the live
     *  item-store registration. Keyed by graph id so switching graphs hides
     *  others; deleting a graph drops its bucket. */
    type GraphState = {
      containers: Map<Id, Container>;
      nest: NestApi;
      storeOff: () => void;
      snapshotOff: () => void;
    };
    const states = new Map<Id, GraphState>();
    const ensureState = (gid: Id): GraphState => {
      const existing = states.get(gid);
      if (existing) return existing;
      const containers = new Map<Id, Container>();
      let restoring = false;
      const nest = createNesting<Container>({
        parents: containers,
        parentKind: 'container',
        onChange: id => { if (!restoring) emit('container.children.changed', { id }); },
      });
      const graph = graphs.get(gid) ?? graphs.current;
      const storeOff = graph.registerItemStore<Container>('container', () => [...containers.values()]);
      const serialize = (): ContainerSnapshot[] => [...containers.values()].map(container => ({
        id: container.id,
        Label: { ...container.Label },
        Position: { ...container.Position },
        Size: { ...container.Size },
        AutoFit: container.AutoFit,
        ContainerType: container.ContainerType,
        Color: container.Color,
        Sections: container.Sections?.map(section => ({ ...section })),
        SectionAxis: container.SectionAxis,
        ChildSections: { ...(container.ChildSections ?? {}) },
        Children: container.Children.map(child => ({ ...child, parent: child.parent ? [...child.parent] : undefined })),
        Legend: container.Legend?.map(entry => ({ ...entry })),
        Multiplier: container.Multiplier,
      }));
      const restore = (value: ContainerSnapshot[] | undefined) => {
        restoring = true;
        try {
          [...containers.values()].forEach(container => container.Children.forEach(child => nest.remove(child)));
          containers.clear();
          const saved = Array.isArray(value) ? value : [];
          saved.forEach(input => {
            if (!input?.id || !input.Label || !input.Position || !input.Size) return;
            containers.set(input.id, {
              id: input.id,
              kind: 'container',
              Label: { ...input.Label },
              Position: { ...input.Position },
              Size: { ...input.Size },
              AutoFit: input.AutoFit,
              ContainerType: input.ContainerType,
              Color: input.Color,
              Sections: input.Sections?.map(section => ({ ...section })) ?? [],
              SectionAxis: input.SectionAxis ?? 'rows',
              ChildSections: { ...(input.ChildSections ?? {}) },
              Children: [],
              // Keep an empty legend as `undefined`, not `[]`, so a
              // legend-free container round-trips to an identical snapshot.
              Legend: sanitizeLegend(input.Legend).length ? sanitizeLegend(input.Legend) : undefined,
              Multiplier: typeof input.Multiplier === 'string' && input.Multiplier.trim() ? input.Multiplier : undefined,
            });
            const sequence = Number.parseInt(input.id.replace(/^\D+/, ''), 10);
            if (Number.isFinite(sequence)) next = Math.max(next, sequence + 1);
          });
          saved.forEach(input => {
            if (!containers.has(input.id)) return;
            input.Children?.forEach(child => {
              if (child?.id && (child.kind === 'node' || child.kind === 'container') && graph.getItem(child)) {
                nest.add(input.id, { ...child, parent: child.parent ? [...child.parent] : undefined });
              }
            });
            const container = containers.get(input.id);
            if (container) sanitizeContainerSections(container);
          });
        } finally {
          restoring = false;
        }
      };
      restore(graph.snapshotExtension<ContainerSnapshot[]>('containers'));
      const snapshotOff = graph.registerSnapshotExtension('containers', serialize, restore);
      const state: GraphState = { containers, nest, storeOff, snapshotOff };
      states.set(gid, state);
      return state;
    };

    return {
      current: () => ensureState(graphs.current.id),
      delete: (id: Id) => {
        const state = states.get(id);
        if (!state) return;
        state.storeOff();
        state.snapshotOff();
        states.delete(id);
      },
      dispose: () => {
        states.forEach(state => {
          state.storeOff();
          state.snapshotOff();
        });
        states.clear();
      },
      ensure: ensureState,
      nextId: () => `c${next++}`,
    };
};

