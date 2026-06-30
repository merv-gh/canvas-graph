import { nodeRef, type Registry } from '../core';
import type { NodePatch, NodeType } from '../model';
import { Places, type Id, type Size } from '../types';

declare module '../types' {
  interface CustomEvents {
    'node.type.set': { id?: Id; nodeType: NodeType };
  }
}

const PANEL_ID = 'node-types';
const PANEL_KEY = 'tool-panel:node-types';
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
    const selectedType = () => selection.selectedNode()?.NodeType ?? 'text';
    const visible = () => !!selectedId();
    let drawQueued = false;

    const setButton = (command: string, text: string, active: boolean) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = command;
      button.className = 'node-type-button';
      button.classList.toggle('active', active);
      button.textContent = text;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      return button;
    };

    const drawPanel = () => {
      if (!visible()) {
        emit('render.view.clear', { place: Places.Stage, key: PANEL_KEY });
        return;
      }
      emit('render.view.set', {
        place: Places.Stage,
        key: PANEL_KEY,
        view: () => {
          const active = selectedType();
          const panel = document.createElement('section');
          panel.className = 'tool-panel node-type-panel';
          panel.dataset.panelId = PANEL_ID;
          panel.dataset.nodeId = selectedId() ?? '';
          panel.style.left = '12px';
          panel.style.bottom = '12px';
          panel.append(
            setButton('node.type.text', 'Text', active === 'text'),
            setButton('node.type.square', 'Box', active === 'square'),
            setButton('node.type.circle', 'Circle', active === 'circle'),
          );
          const props = document.createElement('button');
          props.type = 'button';
          props.className = 'node-type-button';
          props.dataset.command = 'item.properties.open';
          props.textContent = 'Desc';
          props.setAttribute('aria-label', 'Edit node description');
          panel.append(props);
          return panel;
        },
      });
    };
    const scheduleDrawPanel = () => {
      if (drawQueued) return;
      drawQueued = true;
      queueMicrotask(() => {
        drawQueued = false;
        drawPanel();
      });
    };

    const setType = (nodeType: NodeType) => ({ id: selectedId(), nodeType });
    contexts.commands.register([
      { id: 'node.type.text', label: 'Set node shape: text', event: 'node.type.set', group: 'node', available: visible, payload: () => setType('text') },
      { id: 'node.type.square', label: 'Set node shape: square', event: 'node.type.set', group: 'node', available: visible, payload: () => setType('square') },
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

    on('app.start', drawPanel);
    on('selection.changed', scheduleDrawPanel);
    on('graph.node.created', scheduleDrawPanel);
    on('graph.node.updated', scheduleDrawPanel);
    on('graph.node.deleted', scheduleDrawPanel);
    on('graph.switched', scheduleDrawPanel);
  }, { requires: ['graph', 'render.stage', 'ability.selectable'] });
}
