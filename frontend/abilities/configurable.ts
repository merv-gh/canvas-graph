import { itemParentAttr, itemRefFrom, type Registry } from '../core';
import { Slots } from '../types';
import type {
  ItemRef,
  PropertyDef,
  PropertyValue,
} from '../types';
import { ability, action } from './shared';
import type { Identified } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'item.properties.open': ItemRef;
    'properties.item.input': { ref: ItemRef; field: string; value: string };
    'properties.item.toggle': { ref: ItemRef; field: string; checked: boolean };
  }
}

/** Configurable — any entity with declared `properties` can have this. The
 *  properties modal is rendered from `EntityDef.properties` and dispatch
 *  is generic: configurable emits `item.update` with the patch and the
 *  storage system for the ref's kind applies it. */
export const configurable = <T extends Identified>() => ability<T>('configurable', [action<T>({
  id: 'item.configure',
  label: 'Configure',
  paletteCommand: 'item.properties.open',
  ui: [{
    surface: 'entity',
    command: 'item.properties.open',
    kind: 'button',
    slot: Slots.HeaderEnd,
    className: 'node-action node-config',
    text: '⚙',
    label: 'Configure',
  }],
})]);

export function registerConfigurable(system: Registry) {
  system('ability.configurable', ({ on, emit, contexts, graphs, model, selection }) => {
    const formRef = (target?: Element | null): ItemRef =>
      itemRefFrom(target?.closest('.properties')) ?? { kind: 'node', id: '' };
    const item = (ref: ItemRef) => graphs.current.getItem(ref);
    const entityDef = (ref: ItemRef) => model.entity<unknown, unknown>(ref.kind);
    const renderProperties = (ref: ItemRef, current: unknown, properties: PropertyDef<unknown, unknown>[]) => {
      const form = contexts.templates.clone('properties');
      form.dataset.itemKind = ref.kind;
      form.dataset.itemId = ref.id;
      const parent = itemParentAttr(ref.parent);
      if (parent) form.dataset.itemParent = parent;
      const fields = contexts.templates.slot(form, 'fields');
      const byGroup = new Map<string, PropertyDef<unknown, unknown>[]>();
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
        props.forEach(prop => fields.append(contexts.properties.render(prop, current)));
      });
      return form;
    };
    const applyProperty = (ref: ItemRef, field: string, value: PropertyValue) => {
      const current = item(ref);
      const prop = entityDef(ref)?.properties?.find(candidate => candidate.id === field);
      const patch = current && prop?.patch(current, value);
      if (!current || !patch) return;
      // Single generic dispatch. Storage systems decide how to apply for their kind.
      emit('item.update', { ref, patch });
    };
    const selected = () => selection.selected();

    contexts.commands.register([
      {
        id: 'item.properties.open',
        label: 'Open item properties',
        group: 'item',
        shortcut: '.',
        input: { on: 'keydown', key: '.', prevent: true },
        available: source => !!itemRefFrom(source?.target) || !!selected(),
        payload: source => itemRefFrom(source.target) ?? selected() ?? undefined,
      },
      {
        id: 'properties.item.input',
        label: 'Edit item property',
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
  }, { requires: ['ability.selectable', 'modal'] });
}
