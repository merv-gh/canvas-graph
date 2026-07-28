import { edgeRef, nodeRef, type Registry } from '../core';
import { BUILTIN_NODE_TYPES, EDGE_KINDS, isDefaultNodeSize, nodeTypeDefinition, NODE_TYPES, type EdgeKind, type NodeColor, type NodePatch, type NodeType } from '../model';
import type { Id } from '../types';

declare module '../types' {
  interface CustomEvents {
    'node.type.open': void;
    'node.type.set': { id?: Id; nodeType: NodeType };
    'node.color.open': void;
    'node.color.set': { id?: Id; color?: NodeColor };
    'edge.kind.set': { id?: Id; kind: EdgeKind };
    'node.toggle.state': { id?: Id } | void;
  }
}

/** Type commands cover the model catalog. Presets decorate catalog types; they
 * do not own which reusable node types exist. */
const SHAPES: NodeType[] = ['text', 'square', 'circle'];
const ALL_TYPES = BUILTIN_NODE_TYPES.map(def => def.id);
const isTypeChoice = (value: unknown): value is NodeType => !!nodeTypeDefinition(value);

/** Swatch values mirror the `data-node-color` palette in styles.css. */
const COLOR_CHOICES: { value: NodeColor; label: string; swatch: string }[] = [
  { value: 'gray', label: 'Gray', swatch: '#767676' },
  { value: 'red', label: 'Red', swatch: '#dc2626' },
  { value: 'orange', label: 'Orange', swatch: '#ea580c' },
  { value: 'yellow', label: 'Yellow', swatch: '#ca8a04' },
  { value: 'green', label: 'Green', swatch: '#16a34a' },
  { value: 'blue', label: 'Blue', swatch: '#2563eb' },
  { value: 'purple', label: 'Purple', swatch: '#7c3aed' },
  { value: 'pink', label: 'Pink', swatch: '#db2777' },
];
const isColorChoice = (value: unknown): value is NodeColor =>
  COLOR_CHOICES.some(option => option.value === value);

export function registerNodeVisuals(system: Registry) {
  system('node.visuals', ({ on, emit, contexts, graphs, selection }) => {
    const selectedId = () => selection.selectedNode()?.id;
    const visible = () => !!selectedId();
    const toggleNode = (id = selectedId()) => {
      const node = id ? graphs.current.getNode(id) : undefined;
      return node?.NodeType === 'toggle' ? node : undefined;
    };
    const selectedEdgeId = () => {
      const ref = selection.selected();
      return ref?.kind === 'edge' ? ref.id : undefined;
    };
    const edgeSelected = () => !!selectedEdgeId();

    const setType = (nodeType: NodeType) => ({ id: selectedId(), nodeType });
    const setColor = (color?: NodeColor) => ({ id: selectedId(), color });
    contexts.commands.register([
      { id: 'node.type.open', label: 'Set node type…', group: 'node' },
      {
        id: 'node.toggle.state', label: 'Toggle switch', group: 'node',
        available: source => !!toggleNode((source?.target as Element | null)?.closest('[data-item-id]')?.getAttribute('data-item-id') ?? undefined),
        input: { on: 'click', selector: '.node-switch-control', prevent: true, stop: true },
        payload: ({ target }) => ({ id: (target as Element | null)?.closest('[data-item-id]')?.getAttribute('data-item-id') ?? selectedId() }),
      },
      ...ALL_TYPES.map(value => ({
        id: `node.type.${value}`,
        label: SHAPES.includes(value)
          ? `Set node shape: ${nodeTypeDefinition(value)!.label.toLowerCase()}`
          : `Set node type: ${nodeTypeDefinition(value)!.label}`,
        event: 'node.type.set' as const,
        group: 'node',
        available: visible,
        payload: () => setType(value),
      })),
      {
        id: 'node.type.pick',
        label: 'Pick node type',
        event: 'node.type.set',
        group: 'node',
        hidden: true,
        available: visible,
        input: { on: 'click', selector: '[data-type-choice]' },
        payload: ({ target }) => {
          const choice = ((target as HTMLElement | null)?.closest('[data-type-choice]') as HTMLElement | null)?.dataset.typeChoice;
          return isTypeChoice(choice) ? setType(choice) : undefined;
        },
      },
      { id: 'node.color.open', label: 'Set node color…', group: 'node' },
      ...COLOR_CHOICES.map(({ value, label }) => ({
        id: `node.color.${value}`,
        label: `Set node color: ${label}`,
        event: 'node.color.set' as const,
        group: 'node',
        available: visible,
        payload: () => setColor(value),
      })),
      { id: 'node.color.clear', label: 'Set node color: default', event: 'node.color.set', group: 'node', available: visible, payload: () => setColor(undefined) },
      {
        id: 'edge.select',
        label: 'Select edge',
        event: 'selection.item.select' as const,
        group: 'edge',
        available: () => graphs.current.edges().length > 0,
        // Letter-pick an edge — the keyboard route to edge styling (edges are
        // not in the Tab cycle; jump only focuses).
        picker: {
          title: 'Select edge',
          steps: [{ id: 'Edge', prompt: 'Pick edge', filter: () => (ref: { kind: string }) => ref.kind === 'edge' }],
          validate: (values: { Edge?: { id: string } }) => (values.Edge ? undefined : 'Pick an edge.'),
          payload: (values: { Edge?: { kind: string; id: string } }) => values.Edge,
        },
      },
      ...EDGE_KINDS.map(({ value, label }) => ({
        id: `edge.kind.${value}`,
        label: `Set edge appearance: ${label}`,
        event: 'edge.kind.set' as const,
        group: 'edge',
        available: edgeSelected,
        payload: () => ({ id: selectedEdgeId(), kind: value }),
      })),
      {
        id: 'node.color.pick',
        label: 'Pick node color',
        event: 'node.color.set',
        group: 'node',
        hidden: true,
        available: visible,
        input: { on: 'click', selector: '[data-color-choice]' },
        payload: ({ target }) => {
          const choice = ((target as HTMLElement | null)?.closest('[data-color-choice]') as HTMLElement | null)?.dataset.colorChoice;
          if (choice === '') return setColor(undefined);
          return isColorChoice(choice) ? setColor(choice) : undefined;
        },
      },
    ]);

    const typeBody = () => {
      const active = graphs.current.getNode(selectedId() ?? '')?.NodeType ?? 'text';
      const panel = document.createElement('section');
      panel.className = 'type-picker';
      const intro = document.createElement('p');
      intro.textContent = 'Type shapes how the block reads in a diagram. ML types are meant for model architecture maps.';
      const choices = document.createElement('div');
      choices.className = 'type-choices';
      for (const choice of NODE_TYPES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = 'node.type.pick';
        button.dataset.typeChoice = choice.value;
        button.textContent = choice.label;
        button.setAttribute('aria-pressed', choice.value === active ? 'true' : 'false');
        choices.append(button);
      }
      panel.append(intro, choices);
      return panel;
    };

    const colorBody = () => {
      const active = graphs.current.getNode(selectedId() ?? '')?.Color;
      const panel = document.createElement('section');
      panel.className = 'color-picker';
      const intro = document.createElement('p');
      intro.textContent = 'A tint overrides the type color on this node only. Default follows the node type.';
      const choices = document.createElement('div');
      choices.className = 'color-choices';
      const addChoice = (value: string, label: string, swatch?: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = 'node.color.pick';
        button.dataset.colorChoice = value;
        if (swatch) {
          const chip = document.createElement('span');
          chip.className = 'color-swatch';
          chip.style.setProperty('--swatch', swatch);
          button.append(chip);
        }
        button.append(document.createTextNode(label));
        button.setAttribute('aria-pressed', (value || undefined) === active ? 'true' : 'false');
        choices.append(button);
      };
      addChoice('', 'Default');
      for (const choice of COLOR_CHOICES) addChoice(choice.value, choice.label, choice.swatch);
      panel.append(intro, choices);
      return panel;
    };

    on('node.type.open', () => {
      if (!selectedId()) { emit('app.notice', { message: 'Select a node first', level: 'warn' }); return; }
      emit('modal.open', { title: 'Set node type', visual: 'properties', body: typeBody });
    });
    on('node.color.open', () => {
      if (!selectedId()) { emit('app.notice', { message: 'Select a node first', level: 'warn' }); return; }
      emit('modal.open', { title: 'Set node color', visual: 'properties', body: colorBody });
    });

    on('node.type.set', ({ id, nodeType }) => {
      if (!id) return;
      const node = graphs.current.getNode(id);
      if (!node) return;
      const definition = nodeTypeDefinition(nodeType);
      const patch: NodePatch = {
        NodeType: nodeType,
        Fill: definition?.defaultFill,
        BorderColor: definition?.defaultBorder,
      };
      const size = definition?.defaultSize;
      // Operator circles are fixed-size glyphs — always snap; other shapes
      // only snap when the current size is still a default (respect a manual
      // resize).
      if (size && node.NodeType !== nodeType && ((nodeType === 'operator' || nodeType === 'diamond') || isDefaultNodeSize(node.Size))) patch.Size = size;
      emit('item.update', { ref: nodeRef(id), patch });
      emit('palette.arm.sync-type', { type: nodeType });
      emit('modal.close');
    });

    on('node.color.set', ({ id, color }) => {
      if (!id) return;
      if (!graphs.current.getNode(id)) return;
      emit('item.update', { ref: nodeRef(id), patch: { Color: color } });
      emit('modal.close');
    });

    on('node.toggle.state', payload => {
      const id = payload?.id ?? selectedId();
      const node = toggleNode(id);
      if (node) emit('item.update', { ref: nodeRef(node.id), patch: { ToggleState: !node.ToggleState } });
    });

    on('edge.kind.set', ({ id, kind }) => {
      if (!id) return;
      if (!graphs.current.getEdge(id)) return;
      emit('item.update', { ref: edgeRef(id), patch: { EdgeKind: kind } });
    });

  }, { requires: ['graph', 'render.stage', 'ability.selectable'] });
}
