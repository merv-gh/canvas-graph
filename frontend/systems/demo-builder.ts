import type { IntrospectKind, IntrospectRef, SystemCtx } from '../core';
import type { NodeColor, NodeType } from '../model/graph';
import type { Id, ItemRef } from '../types';
import type { ContainerType } from './container-entity';

type DemoBuilderDependencies = {
  emit: SystemCtx['emit'];
  graphs: SystemCtx['graphs'];
};

export const createDemoBuilder = ({ emit, graphs }: DemoBuilderDependencies) => {
    const NODE_KINDS: IntrospectKind[] = ['system', 'ability', 'feature', 'entity', 'collection'];
    const EDGE_RELATIONS = new Set(['requires', 'declares', 'lists']);
    /** Plural human label per kind — used as the container title. */
    const KIND_LABEL: Record<IntrospectKind, string> = {
      system: 'Systems',
      ability: 'Abilities',
      feature: 'Features',
      entity: 'Entities',
      collection: 'Collections',
      command: 'Commands',
      event: 'Events',
    };
    const refKey = (ref: IntrospectRef) => `${ref.kind}:${ref.id}`;
    const containerIds = () =>
      (graphs.current.itemsOfKind('container') as { id: Id }[]).map(c => c.id);
    const clearGraph = () => {
      graphs.current.nodes().slice().forEach(node => emit('graph.node.delete', { id: node.id }));
      containerIds().forEach(id => emit('graph.container.delete', { id }));
    };
    // Node creation schedules the normal auto-layout feature in a microtask.
    // Canonical demos need their authored layout to win after that generic
    // pass, and fitting must use those final positions.
    const finishDemo = (
      layout: 'layout.apply.tidy' | 'layout.apply.radial' | 'layout.apply.vertical' | 'layout.apply.horizontal' | 'layout.apply.tree' | null,
      id?: 'c4' | 'math' | 'workflow' | 'flowchart' | 'mindmap' | 'game' | 'uml' | 'outline' | 'transformer' | 'kimi-k2' | 'agent-observability',
      arrange?: () => void,
    ) => {
      queueMicrotask(() => {
        arrange?.();
        if (layout) emit(layout);
        emit('selection.item.clear');
        emit('view.fit.all');
        if (id) emit('demo.loaded', { id });
      });
    };
    const place = (id: Id | undefined, Position: { x: number; y: number }, Size?: { w: number; h: number }) => {
      if (!id) return;
      emit('item.update', { ref: { kind: 'node', id }, patch: { Position, ...(Size ? { Size } : {}) } });
    };
    const frame = (id: Id | undefined, Position: { x: number; y: number }, Size: { w: number; h: number }) => {
      if (!id) return;
      emit('item.update', { ref: { kind: 'container', id }, patch: { Position, Size, AutoFit: false } });
    };
    const makeContainer = (
      title: string,
      at: { x: number; y: number },
      sections: string[],
      axis: 'rows' | 'columns' = 'rows',
      ContainerType?: ContainerType,
      Color?: NodeColor,
    ) => {
      const before = new Set(containerIds());
      emit('editing.container.create', { Label: { text: title }, at, ContainerType, Color });
      const id = containerIds().find(candidate => !before.has(candidate));
      if (id) {
        emit('item.update', {
          ref: { kind: 'container', id },
          patch: {
            SectionAxis: axis,
            Sections: sections.map((name, index) => ({ id: `s${index + 1}`, title: name, weight: 1 })),
          },
        });
      }
      return id;
    };
    // Per-type authored sizes; shapes and system types keep the 118px default.
    const NODE_SIZES: Partial<Record<NodeType, { w: number; h: number }>> = {
      text: { w: 190, h: 108 },
      'uml-class': { w: 250, h: 170 },
      'list-item': { w: 240, h: 48 },
      'section-header': { w: 280, h: 64 },
      input: { w: 220, h: 64 },
      output: { w: 220, h: 64 },
      embedding: { w: 220, h: 72 },
      dense: { w: 220, h: 72 },
      attention: { w: 220, h: 72 },
      moe: { w: 220, h: 72 },
      norm: { w: 220, h: 48 },
      operator: { w: 44, h: 44 },
      caption: { w: 360, h: 44 },
      agent: { w: 210, h: 96 },
      'timeline-step': { w: 240, h: 88 },
      'data-table': { w: 300, h: 190 },
      toggle: { w: 210, h: 84 },
      artifact: { w: 230, h: 100 },
      'approval-gate': { w: 180, h: 118 },
    };
    const makeNode = (label: string, nodeType: NodeType, description: string, containerId?: string, sectionId?: string, color?: NodeColor) => {
      const node = graphs.current.createNode({
        Label: { text: label },
        NodeType: nodeType,
        Color: color,
        Description: description,
        Size: NODE_SIZES[nodeType] ?? { w: 118, h: 118 },
      });
      if (containerId) emit('container.add-child', { containerId, childRef: { kind: 'node', id: node.id } as ItemRef, sectionId });
      emit('graph.node.created', { graphId: graphs.current.id, id: node.id });
      return node.id;
    };
    return {
      EDGE_RELATIONS,
      KIND_LABEL,
      NODE_KINDS,
      clearGraph,
      containerIds,
      finishDemo,
      frame,
      makeContainer,
      makeNode,
      place,
      refKey,
    };
};
