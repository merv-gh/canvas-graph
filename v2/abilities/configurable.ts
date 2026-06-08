import { itemParentAttr, itemRefFrom, type Registry } from '../core';
import type { GraphEdge, GraphNode } from '../model';
import type {
  EdgePatch,
  ItemRef,
  NodeEntity,
  NodePatch,
  PropertyDef,
  PropertyValue,
} from '../types';
import { ability, action } from './shared';

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

export function registerConfigurable(system: Registry) {
  system('ability.configurable', ({ on, emit, contexts, graphs, model, selection }) => {
    type ConfigItem = GraphNode | GraphEdge;
    type ConfigPatch = NodePatch | EdgePatch;
    const formRef = (target?: Element | null): ItemRef =>
      itemRefFrom(target?.closest('.properties')) ?? { kind: 'node', id: '' };
    const item = (ref: ItemRef): ConfigItem | undefined => graphs.current.getItem(ref) as ConfigItem | undefined;
    const entityDef = (ref: ItemRef) => model.entity<ConfigItem, ConfigPatch>(ref.kind);
    const renderProperties = (ref: ItemRef, item: ConfigItem, properties: PropertyDef<ConfigItem, ConfigPatch>[]) => {
      const form = contexts.templates.clone('properties');
      form.dataset.itemKind = ref.kind;
      form.dataset.itemId = ref.id;
      const parent = itemParentAttr(ref.parent);
      if (parent) form.dataset.itemParent = parent;
      const fields = contexts.templates.slot(form, 'fields');
      const byGroup = new Map<string, PropertyDef<ConfigItem, ConfigPatch>[]>();
      properties.forEach(prop => {
        const group = prop.group ?? 'default';
        (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(prop);
      });
      byGroup.forEach((props, group) => {
        if (group !== 'default') {
          const heading = document.createElement('div');
          heading.className = 'property-group';
          heading.textContent = group;
          fields.append(heading);
        }
        props.forEach(prop => fields.append(contexts.properties.render(prop, item)));
      });
      return form;
    };
    const applyProperty = (ref: ItemRef, field: string, value: PropertyValue) => {
      const current = item(ref);
      const prop = entityDef(ref)?.properties?.find(candidate => candidate.id === field);
      const patch = current && prop?.patch(current, value);
      if (!current || !patch) return;
      if (ref.kind === 'node') emit('graph.node.update', { id: current.id, patch: patch as NodePatch });
      if (ref.kind === 'edge') emit('graph.edge.update', { id: current.id, patch: patch as EdgePatch });
    };
    const selectedNode = () => selection.selectedNode();

    contexts.commands.register([
      {
        id: 'item.properties.open',
        label: 'Open item properties',
        event: 'item.properties.open',
        group: 'item',
        available: source => !!itemRefFrom(source?.target) || !!selectedNode(),
        payload: source => itemRefFrom(source.target) ?? { kind: 'node', id: selectedNode()?.id ?? '' },
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
        input: { on: 'change', selector: '.properties input[type="checkbox"][data-field]' },
        payload: ({ target }) => ({
          ref: formRef(target),
          field: target?.getAttribute('data-field') ?? '',
          checked: (target as HTMLInputElement).checked,
        }),
      },
    ]);

    on('item.properties.open', ref => {
      const current = item(ref);
      const entity = entityDef(ref);
      const properties = entity?.properties ?? [];
      if (!current || !entity || !properties.length) return;
      emit('modal.open', {
        title: `${entity.label} Properties`,
        visual: 'properties',
        body: () => renderProperties(ref, current, properties),
      });
    });
    on('properties.item.input', ({ ref, field, value }) => applyProperty(ref, field, value));
    on('properties.item.toggle', ({ ref, field, checked }) => applyProperty(ref, field, checked));
  });
}
