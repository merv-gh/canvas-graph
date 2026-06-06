import {
  isStageSurface,
  itemIdFrom,
  itemRefFrom,
  type Registry,
} from './core';
import type { GraphNode } from './model';
import type {
  AbilityDef,
  ActionDef,
  CommandSource,
  Id,
  ItemRef,
  NodeEntity,
  NodePatch,
  NonEmptyArray,
  Position,
  PropertyDef,
  PropertyValue,
} from './types';
import { Places } from './types';

const action = <T,>(def: ActionDef<T>) => def;
const ability = <T,>(id: string, actions: NonEmptyArray<ActionDef<T>>): AbilityDef<T> => ({ id, actions });

export const selectable = <T extends NodeEntity>() => ability<T>('selectable', [action<T>({
  id: 'node.select',
  label: 'Select node',
  paletteCommand: 'selection.node.next',
  ui: [{ surface: 'entity', command: 'selection.node.select', kind: 'handler' }],
})]);

export const draggable = <T extends NodeEntity>() => ability<T>('draggable', [action<T>({
  id: 'node.drag',
  label: 'Move node',
  paletteCommand: 'graph.node.nudge.right',
  ui: [{ surface: 'entity', command: 'drag.node.start', kind: 'handler', slot: 'header', attrs: { 'data-drag-handle': '' } }],
})]);

export const collapsible = <T extends NodeEntity>() => ability<T>('collapsible', [action<T>({
  id: 'node.collapse',
  label: 'Collapse node',
  paletteCommand: 'node.collapse.toggle',
  ui: [{
    surface: 'entity',
    command: 'node.collapse.toggle',
    kind: 'button',
    slot: 'header:start',
    className: 'node-action node-toggle',
    text: node => node.Collapsed ? '+' : '-',
    label: node => node.Collapsed ? 'Expand node' : 'Collapse node',
  }],
})]);

export const editable = <T extends NodeEntity>() => ability<T>('editable', [action<T>({
  id: 'node.title.edit',
  label: 'Edit node title',
  paletteCommand: 'node.title.edit',
  ui: [{
    surface: 'entity',
    command: 'node.title.edit',
    kind: 'handler',
    slot: 'title',
    className: 'editable-inline',
    attrs: { contenteditable: 'plaintext-only', 'data-command': 'node.title.edit' },
  }],
})]);

export const configurable = <T extends NodeEntity>() => ability<T>('configurable', [action<T>({
  id: 'node.configure',
  label: 'Configure node',
  paletteCommand: 'item.properties.open',
  ui: [{
    surface: 'entity',
    command: 'item.properties.open',
    kind: 'button',
    slot: 'header:end',
    className: 'node-action node-config',
    text: '⚙',
    label: 'Configure node',
  }],
})]);

export function registerAbilitySystems(system: Registry) {
  system('ability.selectable', ({ on, emit, contexts, graphs }) => {
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.selected || '';
    const nextNodeId = () => {
      const nodes = graphs.current.nodes();
      const index = Math.max(0, nodes.findIndex(node => node.id === graphs.current.selected));
      return nodes[(index + 1) % nodes.length]?.id ?? nodes[0]?.id ?? '';
    };

    contexts.commands.register([
      {
        id: 'selection.node.select',
        label: 'Select node',
        event: 'selection.node.select',
        group: 'selection',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-node-id]', when: event => !(event.target as Element).closest('[data-command]'), prevent: true },
        payload: source => ({ id: nodeId(source) }),
      },
      {
        id: 'selection.node.next',
        label: 'Select next node',
        event: 'selection.node.select',
        group: 'selection',
        shortcut: 'Tab',
        input: { on: 'keydown', key: 'Tab', prevent: true },
        available: () => graphs.current.nodes().length > 0,
        payload: () => ({ id: nextNodeId() }),
      },
      {
        id: 'selection.node.clear',
        label: 'Clear selection',
        event: 'selection.node.clear',
        group: 'selection',
        available: () => !!graphs.current.selected,
        input: { on: 'pointerdown', selector: `[data-place="${Places.Stage}"]`, when: isStageSurface },
      },
    ]);

    on('selection.node.select', ({ id }) => { graphs.current.selected = id; emit('selection.node.selected', { id }); });
    on('selection.node.clear', () => { graphs.current.selected = null; emit('selection.node.selected', { id: null }); });
  });

  system('ability.draggable', ({ on, emit, contexts, graphs }) => {
    let drag: { id: Id; pointer: Position; start: Position } | null = null;
    const selectedNode = () => graphs.current.selectedNode();

    contexts.commands.register([
      {
        id: 'graph.node.nudge.right',
        label: 'Nudge node right',
        event: 'graph.node.update',
        group: 'node',
        shortcut: 'ArrowRight',
        input: { on: 'keydown', key: 'ArrowRight', prevent: true },
        available: () => !!selectedNode(),
        payload: () => {
          const node = selectedNode()!;
          const pos = node.Position ?? { x: 0, y: 0 };
          return { id: node.id, patch: { Position: { x: pos.x + 24, y: pos.y } } };
        },
      },
      {
        id: 'drag.node.start',
        label: 'Start drag',
        event: 'drag.node.start',
        group: 'drag',
        hidden: true,
        input: { on: 'pointerdown', selector: '[data-drag-handle]', when: event => !(event.target as Element).closest('[data-command]'), prevent: true },
        payload: ({ event, target }) => ({ id: itemIdFrom(target), x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      {
        id: 'drag.node.move',
        label: 'Move dragged node',
        event: 'drag.node.move',
        group: 'drag',
        hidden: true,
        input: { on: 'pointermove', when: () => !!drag, prevent: true },
        payload: ({ event }) => ({ x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY }),
      },
      { id: 'drag.node.end', label: 'End drag', event: 'drag.node.end', group: 'drag', hidden: true, input: { on: 'pointerup', when: () => !!drag } },
    ]);

    on('drag.node.start', ({ id, x, y }) => {
      const node = graphs.current.node(id);
      if (node?.Position) drag = { id, pointer: contexts.view.clientToSpace(Places.Stage, { x, y }), start: { ...node.Position } };
    });
    on('drag.node.move', ({ x, y }) => {
      if (!drag) return;
      const pointer = contexts.view.clientToSpace(Places.Stage, { x, y });
      emit('graph.node.update', { id: drag.id, patch: { Position: { x: drag.start.x + pointer.x - drag.pointer.x, y: drag.start.y + pointer.y - drag.pointer.y } } });
      emit('drag.node.moved', { id: drag.id });
    });
    on('drag.node.end', () => { drag = null; });
  });

  system('ability.collapsible', ({ contexts, graphs }) => {
    const selectedNode = () => graphs.current.selectedNode();
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.selected || '';

    contexts.commands.register([{
      id: 'node.collapse.toggle',
      label: 'Toggle node collapse',
      event: 'graph.node.update',
      group: 'node',
      shortcut: 'C',
      input: { on: 'keydown', key: 'c', prevent: true },
      available: source => !!nodeId(source ?? {}) || !!selectedNode(),
      payload: source => {
        const id = nodeId(source) || graphs.current.selected || graphs.current.nodes()[0]?.id || '';
        const node = graphs.current.node(id)!;
        return { id, patch: { Collapsed: !node.Collapsed } };
      },
    }]);
  });

  system('ability.editable', ({ on, emit, contexts, graphs }) => {
    const titleEl = (id: Id) => document.querySelector(`.node[data-node-id="${id}"] .node-title`);
    const nodeId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.selected || '';
    const titleCommit = (target?: Element | null, finish = false) => ({
      id: itemIdFrom(target),
      text: target?.textContent?.trim() ?? '',
      finish,
    });

    contexts.commands.register([
      {
        id: 'node.title.edit',
        label: 'Edit node title',
        event: 'node.title.edit',
        group: 'node',
        shortcut: 'Enter',
        input: { on: 'keydown', key: 'Enter', prevent: true },
        available: source => !!nodeId(source ?? {}) || !!graphs.current.selectedNode(),
        payload: source => ({ id: nodeId(source) || graphs.current.selected || '' }),
      },
      {
        id: 'node.title.commit.enter',
        label: 'Commit node title',
        event: 'node.title.commit',
        group: 'node',
        hidden: true,
        input: { on: 'keydown', key: 'Enter', selector: '.node-title', prevent: true },
        payload: ({ target }) => titleCommit(target, true),
      },
      {
        id: 'node.title.commit.focusout',
        label: 'Commit node title focusout',
        event: 'node.title.commit',
        group: 'node',
        hidden: true,
        input: { on: 'focusout', selector: '.node-title' },
        payload: ({ target }) => titleCommit(target),
      },
    ]);

    on('node.title.edit', ({ id }) => queueMicrotask(() => {
      const title = titleEl(id);
      if (!(title instanceof HTMLElement)) return;
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }));
    on('node.title.commit', ({ id, text, finish }) => {
      const node = graphs.current.node(id);
      if (!node) return;
      if (text && text !== node.Label.text) emit('graph.node.update', { id, patch: { Label: { text } } });
      if (!text) {
        const title = titleEl(id);
        if (title) title.textContent = node.Label.text;
      }
      if (finish) queueMicrotask(() => {
        const title = titleEl(id);
        if (title instanceof HTMLElement) title.blur();
      });
    });
  });

  system('ability.configurable', ({ on, emit, contexts, graphs, model }) => {
    const formRef = (target?: Element | null): ItemRef => {
      const form = target?.closest('.properties');
      return {
        kind: (form?.getAttribute('data-item-kind') as ItemRef['kind']) || 'node',
        id: form?.getAttribute('data-item-id') ?? '',
      };
    };
    const item = (ref: ItemRef) => ref.kind === 'node' ? graphs.current.node(ref.id) : undefined;
    const entityDef = (ref: ItemRef) => ref.kind === 'node' ? model.entity<GraphNode, NodePatch>('node') : undefined;
    const propertyInput = (node: GraphNode, prop: PropertyDef<GraphNode, NodePatch>) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.dataset.field = prop.id;
      input.type = prop.input === 'checkbox' ? 'checkbox' : prop.input;
      if (prop.min != null) input.min = `${prop.min}`;
      if (prop.step != null) input.step = `${prop.step}`;
      if (prop.input === 'checkbox') {
        label.className = 'check-row';
        input.checked = Boolean(prop.value(node));
        label.append(input, prop.label);
      } else {
        if (prop.input === 'text') input.classList.add('editable-inline');
        input.value = String(prop.value(node));
        label.append(prop.label, input);
      }
      return label;
    };
    const renderProperties = (ref: ItemRef, node: GraphNode, properties: PropertyDef<GraphNode, NodePatch>[]) => {
      const form = contexts.templates.clone('properties');
      form.dataset.itemKind = ref.kind;
      form.dataset.itemId = ref.id;
      const fields = contexts.templates.slot(form, 'fields');
      properties.forEach(prop => fields.append(propertyInput(node, prop)));
      return form;
    };
    const applyProperty = (ref: ItemRef, field: string, value: PropertyValue) => {
      const node = item(ref);
      const prop = entityDef(ref)?.properties?.find(candidate => candidate.id === field);
      const patch = node && prop?.patch(node, value);
      if (node && patch) emit('graph.node.update', { id: node.id, patch });
    };
    const selectedNode = () => graphs.current.selectedNode();

    contexts.commands.register([
      {
        id: 'item.properties.open',
        label: 'Open item properties',
        event: 'item.properties.open',
        group: 'item',
        available: source => !!itemRefFrom(source?.target) || !!selectedNode(),
        payload: source => itemRefFrom(source.target) ?? { kind: 'node', id: graphs.current.selected || '' },
      },
      {
        id: 'properties.item.input',
        label: 'Edit item property',
        event: 'properties.item.input',
        group: 'properties',
        hidden: true,
        input: { on: 'input', selector: '.properties input[data-field]:not([type="checkbox"])' },
        payload: ({ target }) => ({
          ref: formRef(target),
          field: target?.getAttribute('data-field') ?? '',
          value: (target as HTMLInputElement).value,
        }),
      },
      {
        id: 'properties.item.toggle',
        label: 'Toggle item property',
        event: 'properties.item.toggle',
        group: 'properties',
        hidden: true,
        input: { on: 'change', selector: '.properties [data-field="collapsed"]' },
        payload: ({ target }) => ({
          ref: formRef(target),
          field: target?.getAttribute('data-field') ?? '',
          checked: (target as HTMLInputElement).checked,
        }),
      },
    ]);

    on('item.properties.open', ref => {
      const node = item(ref);
      const entity = entityDef(ref);
      const properties = entity?.properties ?? [];
      if (!node || !entity || !properties.length) return;
      emit('modal.open', {
        title: `${entity.label} Properties`,
        visual: 'properties',
        body: () => renderProperties(ref, node, properties),
      });
    });
    on('properties.item.input', ({ ref, field, value }) => applyProperty(ref, field, value));
    on('properties.item.toggle', ({ ref, field, checked }) => applyProperty(ref, field, checked));
  });
}
