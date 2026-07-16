import { nodeRef, type Registry } from '../core';
import type { NodePatch, NodeType } from '../model';
import type { Id, Size } from '../types';

declare module '../types' {
  interface CustomEvents {
    'node.type.set': { id?: Id; nodeType: NodeType };
  }
}

const SHAPE_SIZE: Partial<Record<NodeType, Size>> = {
  text: { w: 170, h: 76 },
  square: { w: 112, h: 112 },
  circle: { w: 112, h: 112 },
};
const TEXT_SIZE = SHAPE_SIZE.text!;
const SQUARE_SIZE = SHAPE_SIZE.square!;

const isDefaultish = (size: Size) =>
  (size.w === 150 && size.h === 64)
  || (size.w === TEXT_SIZE.w && size.h === TEXT_SIZE.h)
  || (size.w === SQUARE_SIZE.w && size.h === SQUARE_SIZE.h);

export function registerNodeVisuals(system: Registry) {
  system('node.visuals', ({ on, emit, contexts, graphs, selection }) => {
    const selectedId = () => selection.selectedNode()?.id;
    const visible = () => !!selectedId();

    const setType = (nodeType: NodeType) => ({ id: selectedId(), nodeType });
    contexts.commands.register([
      { id: 'node.type.text', label: 'Set node shape: text', event: 'node.type.set', group: 'node', available: visible, payload: () => setType('text') },
      { id: 'node.type.square', label: 'Set node shape: box', event: 'node.type.set', group: 'node', available: visible, payload: () => setType('square') },
      { id: 'node.type.circle', label: 'Set node shape: circle', event: 'node.type.set', group: 'node', available: visible, payload: () => setType('circle') },
    ]);

    on('node.type.set', ({ id, nodeType }) => {
      if (!id) return;
      const node = graphs.current.getNode(id);
      if (!node) return;
      const patch: NodePatch = { NodeType: nodeType };
      const size = SHAPE_SIZE[nodeType];
      if (size && node.NodeType !== nodeType && isDefaultish(node.Size)) patch.Size = size;
      emit('item.update', { ref: nodeRef(id), patch });
    });
  }, { requires: ['graph', 'render.stage', 'ability.selectable'] });
}
