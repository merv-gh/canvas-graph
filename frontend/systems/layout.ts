import { nodeRef, type Registry } from '../core';
import type { Id, ItemRef, Position } from '../types';

export type LayoutKind = 'vertical' | 'horizontal' | 'tree' | 'radial';
type LayoutCommandKind = LayoutKind | 'grid' | 'tidy';
type LayoutSnapshot = { version: 1; kind: LayoutKind };
type LayoutCreation = {
  Position?: Position;
  relativeTo?: Id;
  connectFrom?: Id;
  keepFocus?: boolean;
};

export type LayoutApi = {
  active(): LayoutKind;
  /** Resolve A / Shift+A into a stable position and relationship for the
   *  active visual grammar. `alternate` is the Shift+A branch gesture. */
  creation(selectedId: Id | undefined, alternate: boolean): LayoutCreation;
};

declare module '../types' {
  interface CustomEvents {
    'layout.apply.radial': void;
    'layout.apply.grid': void;
    'layout.apply.tidy': void;
    'layout.apply.vertical': void;
    'layout.apply.horizontal': void;
    'layout.apply.tree': void;
    'layout.mode.changed': { kind: LayoutKind };
    /** Reflow only the named sectioned container. This is structural placement,
     *  not a whole-graph layout, and never reframes the camera. */
    'layout.apply.sections': { id: string };
    /** User-triggered layout: apply the algorithm AND re-frame the view. The bare
     *  `layout.apply.*` events stay fit-free so programmatic callers can compose
     *  an explicit layout with their own viewport behavior. */
    'layout.fit': { kind: LayoutCommandKind };
  }
  interface CustomExposable {
    layout?: LayoutApi;
  }
}

import {
  applyLabelAware,
  GAP_X,
  GAP_Y,
  gridScope,
  horizontalScope,
  partitionByScope,
  radialRootOf,
  radialScope,
  sectionedScope,
  tidyScope,
  verticalScope,
  sizeOf,
  type PatchEmit,
} from './layout-algorithms';

export { partitionByScope, type LayoutScope } from './layout-algorithms';
export function registerLayout(system: Registry) {
  system('layout', (ctx) => {
    const { on, emit, contexts, graphs, selection } = ctx;
    type GraphLayoutState = { kind: LayoutKind; snapshotOff: () => void };
    const states = new Map<Id, GraphLayoutState>();
    let syncModeUi = () => {};
    const validKind = (value: unknown): value is LayoutKind =>
      value === 'vertical' || value === 'horizontal' || value === 'tree' || value === 'radial';
    const ensureState = (graphId: Id) => {
      const existing = states.get(graphId);
      if (existing) return existing;
      const graph = graphs.get(graphId) ?? graphs.current;
      const stored = graph.snapshotExtension<LayoutSnapshot>('layoutStyle');
      const state: GraphLayoutState = {
        kind: stored?.version === 1 && validKind(stored.kind) ? stored.kind : 'tree',
        snapshotOff: () => {},
      };
      const restore = (value: LayoutSnapshot | undefined) => {
        state.kind = value?.version === 1 && validKind(value.kind) ? value.kind : 'tree';
        queueMicrotask(syncModeUi);
      };
      state.snapshotOff = graph.registerSnapshotExtension<LayoutSnapshot>(
        'layoutStyle',
        () => ({ version: 1, kind: state.kind }),
        restore,
      );
      states.set(graphId, state);
      return state;
    };
    const active = () => ensureState(graphs.current.id).kind;
    const outgoingCount = (id: Id) => graphs.current.edges().filter(edge => edge.From === id).length;
    const alternatingSlot = (index: number) => index === 0 ? 0 : (index % 2 ? Math.ceil(index / 2) : -index / 2);
    const creation = (selectedId: Id | undefined, alternate: boolean): LayoutCreation => {
      const selected = selectedId ? graphs.current.getNode(selectedId) : undefined;
      if (!selected?.Position) return {};
      const source = selected.id;
      const sourceSize = sizeOf(selected);
      const newSize = { w: 150, h: 64 };
      const ordinal = outgoingCount(source);
      const slot = alternatingSlot(ordinal);
      const common = { relativeTo: source };
      switch (active()) {
        case 'vertical':
          return alternate ? {
            ...common,
            Position: {
              x: selected.Position.x + sourceSize.w / 2 + GAP_X + newSize.w / 2,
              y: selected.Position.y + slot * (newSize.h + 24),
            },
            connectFrom: source,
            keepFocus: true,
          } : {
            ...common,
            Position: {
              x: selected.Position.x,
              y: selected.Position.y + sourceSize.h / 2 + 24 + newSize.h / 2,
            },
          };
        case 'horizontal':
          return alternate ? {
            ...common,
            Position: {
              x: selected.Position.x + slot * (newSize.w + 36),
              y: selected.Position.y + sourceSize.h / 2 + GAP_Y + newSize.h / 2,
            },
            connectFrom: source,
            keepFocus: true,
          } : {
            ...common,
            Position: {
              x: selected.Position.x + sourceSize.w / 2 + 36 + newSize.w / 2,
              y: selected.Position.y,
            },
          };
        case 'radial': {
          const angle = -Math.PI / 2 + ordinal * 2.399963229728653;
          const radius = Math.max(220, Math.max(sourceSize.w, sourceSize.h) / 2 + 150);
          return {
            ...common,
            Position: {
              x: selected.Position.x + Math.cos(angle) * radius,
              y: selected.Position.y + Math.sin(angle) * radius,
            },
            connectFrom: source,
            ...(alternate ? { keepFocus: true } : {}),
          };
        }
        case 'tree':
        default:
          return {
            ...common,
            Position: {
              x: selected.Position.x + slot * (newSize.w + GAP_X),
              y: selected.Position.y + sourceSize.h / 2 + GAP_Y + newSize.h / 2,
            },
            connectFrom: source,
            ...(alternate ? { keepFocus: true } : {}),
          };
      }
    };
    ctx.expose('layout', { active, creation });

    // Layout modes stay one command away through keyboard or command menu. A
    // persistent four-button canvas panel made every graph feel like layout UI.
    // User-facing commands re-frame after applying (via layout.fit); the raw
    // layout.apply.* events do the layout only for explicit programmatic use.
    contexts.commands.register([
      { id: 'layout.apply.vertical', label: 'Use vertical nested-list layout', group: 'layout', event: 'layout.fit', input: { on: 'keydown', key: 'v', prevent: true }, payload: () => ({ kind: 'vertical' }) },
      { id: 'layout.apply.horizontal', label: 'Use horizontal nested-list layout', group: 'layout', event: 'layout.fit', input: { on: 'keydown', key: 'h', prevent: true }, payload: () => ({ kind: 'horizontal' }) },
      { id: 'layout.apply.tree', label: 'Use top-down tree layout', group: 'layout', event: 'layout.fit', input: { on: 'keydown', key: 't', prevent: true }, payload: () => ({ kind: 'tree' }) },
      { id: 'layout.apply.radial', label: 'Use radial map layout', group: 'layout', event: 'layout.fit', input: { on: 'keydown', key: 'r', prevent: true }, payload: () => ({ kind: 'radial' }) },
      { id: 'layout.apply.grid', label: 'Grid layout (legacy)', group: 'layout', event: 'layout.fit', hidden: true, input: { on: 'keydown', key: 'G', shift: true, prevent: true }, payload: () => ({ kind: 'grid' }) },
      { id: 'layout.apply.tidy', label: 'Tree layout (legacy Tidy)', group: 'layout', event: 'layout.fit', hidden: true, payload: () => ({ kind: 'tree' }) },
    ]);

    const creationLabels: Record<LayoutKind, [string, string]> = {
      vertical: ['Create node below — next vertical item', 'Create connected child node right — vertical branch'],
      horizontal: ['Create node right — next horizontal item', 'Create connected child node below — horizontal branch'],
      tree: ['Create node below — continue tree child', 'Create sibling branch node — keep parent selected'],
      radial: ['Create node outward — radial drill-down', 'Create spoke node — keep hub selected'],
    };
    syncModeUi = () => {
      const labels = creationLabels[active()];
      const primary = contexts.commands.get('editing.node.create');
      const alternate = contexts.commands.get('editing.node.create.keep');
      if (primary) primary.label = labels[0];
      if (alternate) alternate.label = labels[1];
      emit('affordance.contributed', { surface: 'top' });
    };
    const activate = (kind: LayoutKind) => {
      const state = ensureState(graphs.current.id);
      state.kind = kind;
      syncModeUi();
      emit('layout.mode.changed', { kind });
    };

    const set: PatchEmit = (id, Position) => emit('item.update', { ref: nodeRef(id), patch: { Position } });
    const layoutNestedContainers = (parentId: string) => {
      const parent = ctx.graphs.current.getItem({ kind: 'container', id: parentId }) as {
        Position?: Position;
        Children?: ItemRef[];
      } | undefined;
      if (!parent?.Children?.length) return;
      const children = parent.Children
        .filter(ref => ref.kind === 'container')
        .map(ref => {
          const item = ctx.graphs.current.getItem(ref) as { Position?: Position; Size?: { w: number; h: number } } | undefined;
          const bounds = item && ctx.model.entity(ref.kind)?.render?.bounds?.(item as never);
          return item && bounds ? { ref, item, size: { w: bounds.w, h: bounds.h } } : null;
        })
        .filter((child): child is NonNullable<typeof child> => !!child);
      if (!children.length) return;
      const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(children.length))));
      const rows = Math.ceil(children.length / cols);
      const colWidths = Array.from({ length: cols }, () => 0);
      const rowHeights = Array.from({ length: rows }, () => 0);
      children.forEach((child, index) => {
        const col = index % cols, row = Math.floor(index / cols);
        colWidths[col] = Math.max(colWidths[col], child.size.w);
        rowHeights[row] = Math.max(rowHeights[row], child.size.h);
      });
      const directNodeBottom = parent.Children
        .filter(ref => ref.kind === 'node')
        .map(ref => {
          const node = ctx.graphs.current.getNode(ref.id);
          return node?.Position ? node.Position.y + node.Size.h / 2 : -Infinity;
        })
        .reduce((max, value) => Math.max(max, value), -Infinity);
      const totalW = colWidths.reduce((sum, width) => sum + width, 0) + GAP_X * Math.max(0, cols - 1);
      const startX = (parent.Position?.x ?? 0) - totalW / 2;
      let rowTop = Number.isFinite(directNodeBottom) ? directNodeBottom + GAP_Y : (parent.Position?.y ?? 0);
      const rowTops = rowHeights.map(height => {
        const current = rowTop;
        rowTop += height + GAP_Y;
        return current;
      });
      const colLefts: number[] = [];
      let colLeft = startX;
      colWidths.forEach(width => { colLefts.push(colLeft); colLeft += width + GAP_X; });
      children.forEach((child, index) => {
        const col = index % cols, row = Math.floor(index / cols);
        emit('item.update', {
          ref: child.ref,
          patch: { Position: { x: colLefts[col] + child.size.w / 2, y: rowTops[row] + child.size.h / 2 } },
        });
      });
    };
    const compactEmptyRootContainers = () => {
      const nodes = ctx.graphs.current.nodes().filter(node => !!node.Position);
      if (!nodes.length) return;
      const minY = Math.min(...nodes.map(node => node.Position!.y - sizeOf(node).h / 2));
      const maxY = Math.max(...nodes.map(node => node.Position!.y + sizeOf(node).h / 2));
      let cursorX = Math.max(...nodes.map(node => node.Position!.x + sizeOf(node).w / 2)) + GAP_X;
      const containers = ctx.graphs.current.itemsOfKind('container') as Array<{
        id: string;
        Children?: ItemRef[];
        Position?: Position;
        Size?: { w: number; h: number };
      }>;
      containers
        .filter(container => !container.Children?.length
          && !contexts.hierarchy.parentRefOf({ kind: 'container', id: container.id }))
        .forEach(container => {
          const size = container.Size ?? { w: 220, h: 150 };
          emit('item.update', {
            ref: { kind: 'container', id: container.id },
            patch: { Position: { x: cursorX + size.w / 2, y: (minY + maxY) / 2 } },
          });
          cursorX += size.w + GAP_X;
        });
    };

    on('layout.apply.vertical', () => {
      activate('vertical');
      partitionByScope(ctx).forEach(scope => applyLabelAware(scope, verticalScope, set));
    });
    on('layout.apply.horizontal', () => {
      activate('horizontal');
      partitionByScope(ctx).forEach(scope => applyLabelAware(scope, horizontalScope, set));
    });
    on('layout.apply.tree', () => {
      activate('tree');
      partitionByScope(ctx).forEach(scope => applyLabelAware(scope, tidyScope, set));
    });
    on('layout.apply.tidy', () => {
      activate('tree');
      partitionByScope(ctx).forEach(scope => applyLabelAware(scope, tidyScope, set));
    });
    on('layout.apply.grid', () => partitionByScope(ctx).forEach(scope => applyLabelAware(scope, gridScope, set)));
    on('layout.apply.sections', ({ id }) => {
      const scope = partitionByScope(ctx).find(candidate =>
        candidate.parent?.kind === 'container' && candidate.parent.id === id);
      if (scope) applyLabelAware(scope, sectionedScope, set);
      layoutNestedContainers(id);
    });
    on('layout.apply.radial', () => {
      activate('radial');
      const focusedId = selection.focusedNode()?.id ?? selection.selectedNode()?.id;
      partitionByScope(ctx).forEach(scope => {
        const rootId = radialRootOf(scope, focusedId)?.id;
        applyLabelAware(scope, (candidate, patch) => radialScope(candidate, focusedId, patch), set, rootId);
      });
    });
    // Apply the algorithm, then fit — so switching layouts re-centers the graph and
    // it never "walks away" off-screen.
    on('layout.fit', ({ kind }) => {
      emit(({
        vertical: 'layout.apply.vertical',
        horizontal: 'layout.apply.horizontal',
        tree: 'layout.apply.tree',
        tidy: 'layout.apply.tidy',
        grid: 'layout.apply.grid',
        radial: 'layout.apply.radial',
      } as const)[kind]);
      compactEmptyRootContainers();
      emit('view.fit.all');
    });
    on('graph.switched', ({ id }) => {
      ensureState(id);
      syncModeUi();
      emit('layout.mode.changed', { kind: active() });
    });
    on('graph.deleted', ({ id }) => {
      states.get(id)?.snapshotOff();
      states.delete(id);
    });
    on('app.start', () => {
      ensureState(graphs.current.id);
      syncModeUi();
    });
  }, { requires: ['graph'] });
}
