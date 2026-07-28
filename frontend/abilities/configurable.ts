import { itemRefFrom, type Registry } from '../core';
import { Places, Slots } from '../types';
import type {
  ItemRef,
} from '../types';
import { ability, action } from './shared';
import { createPropertiesInspector } from './configurable-inspector';
import type { Identified } from './shapes';

declare module '../types' {
  interface CustomEvents {
    'item.properties.open': ItemRef;
    'properties.item.input': { ref: ItemRef; field: string; value: string };
    'properties.item.choice': { ref: ItemRef; field: string; value: string };
    'properties.item.toggle': { ref: ItemRef; field: string; checked: boolean };
    'properties.title.input': { ref: ItemRef; value: string };
    'properties.title.finish': { ref: ItemRef };
    'properties.structure.axis': { ref: ItemRef; value: string };
    'properties.sections.input': { ref: ItemRef; value: string };
    'properties.sections.add': { ref: ItemRef };
    'properties.sections.remove': { ref: ItemRef; index: number };
    'properties.group.toggle': { ref: ItemRef; group: string; open: boolean };
  }
}
/** Configurable — any entity with declared `properties` can have this. The
 *  selection inspector is rendered from `EntityDef.properties` and dispatch
 *  is generic: configurable emits `item.update` with the patch and the
 *  storage system for the ref's kind applies it. */
export const configurable = <T extends Identified>() => ability<T>('configurable', [action<T>({
  id: 'item.configure',
  label: 'Edit details',
  paletteCommand: 'item.properties.open',
  ui: [{
    surface: 'entity',
    command: 'item.properties.open',
    kind: 'button',
    slot: Slots.HeaderEnd,
    className: 'node-action node-config',
    text: 'Edit',
    label: 'Edit title, description, and shape',
  }],
})]);

export function registerConfigurable(system: Registry) {
  system('ability.configurable', ({ on, emit, contexts, graphs, model, selection, declarePanel }) => {
    const formRef = (target?: Element | null): ItemRef =>
      itemRefFrom(target?.closest('.properties')) ?? { kind: 'node', id: '' };
    const item = (ref: ItemRef) => graphs.current.getItem(ref);
    const entityDef = (ref: ItemRef) => model.entity<unknown, unknown>(ref.kind);
    const sectionValues = (root: Element) => [...root.querySelectorAll<HTMLInputElement>('[data-section-input]')]
      .map(input => input.value.trim()).filter(Boolean);
    const expandedGroups = new Set<string>();
    const expandedGroupKey = (ref: ItemRef, group: string) => `${ref.kind}:${ref.id}:${group}`;
    const {
      applyProperty,
      inspectable,
      inspectorRoot,
      queueInspectorRedraw,
      renderInspector,
      sectionRow,
      selected,
    } = createPropertiesInspector({
      contexts,
      emit,
      entityDef,
      expandedGroupKey,
      expandedGroups,
      graphs,
      item,
      model,
      selection,
    });

    declarePanel({
      id: 'properties', anchor: 'top-left', place: Places.Left, movable: false, layout: 'custom', render: renderInspector, order: 2,
      mountWhen: () => !!inspectable(),
    });

    contexts.commands.register([
      {
        id: 'item.properties.open',
        label: 'Open item inspector',
        group: 'item',
        available: source => !!itemRefFrom(source?.target) || !!selected(),
        payload: source => itemRefFrom(source.target) ?? selected() ?? undefined,
      },
      {
        id: 'properties.title.input', label: 'Rename item from inspector', group: 'properties', hidden: true,
        input: { on: 'input', selector: '[data-item-modal-title]' },
        payload: ({ target }) => ({
          ref: itemRefFrom(target) ?? { kind: 'node', id: '' },
          value: (target as HTMLInputElement).value,
        }),
      },
      {
        id: 'properties.title.finish.enter', label: 'Finish inspector title (Enter)', event: 'properties.title.finish', group: 'properties', hidden: true,
        input: { on: 'keydown', key: 'Enter', selector: '[data-item-modal-title]', prevent: true, stop: true },
        payload: ({ target }) => ({ ref: itemRefFrom(target) ?? { kind: 'node', id: '' } }),
      },
      {
        id: 'properties.structure.axis', label: 'Change container section direction', group: 'properties', hidden: true,
        payload: ({ target }) => ({ ref: formRef(target), value: (target as HTMLElement).closest('[data-axis]')?.getAttribute('data-axis') ?? 'rows' }),
      },
      {
        id: 'properties.sections.input', label: 'Rename container section', group: 'properties', hidden: true,
        input: { on: 'input', selector: '.properties [data-section-input]' },
        payload: ({ target }) => ({ ref: formRef(target), value: sectionValues(target?.closest('.properties') ?? document.body).join('\n') }),
      },
      {
        id: 'properties.sections.add', label: 'Add container section', group: 'properties', hidden: true,
        payload: ({ target }) => ({ ref: formRef(target) }),
      },
      {
        id: 'properties.sections.remove', label: 'Remove container section', group: 'properties', hidden: true,
        payload: ({ target }) => ({ ref: formRef(target), index: Number((target as HTMLElement).closest('[data-section-index]')?.getAttribute('data-section-index') ?? -1) }),
      },
      {
        id: 'properties.group.toggle', label: 'Expand or collapse property group', group: 'properties', hidden: true,
        payload: ({ target }) => {
          const advanced = target?.closest<HTMLElement>('.property-advanced-group');
          return {
            ref: formRef(advanced),
            group: advanced?.dataset.propertyGroup ?? '',
            open: advanced?.dataset.open !== 'true',
          };
        },
      },
      {
        id: 'properties.item.choice',
        label: 'Choose item property',
        group: 'properties',
        hidden: true,
        payload: ({ target }) => {
          const choice = (target as HTMLElement).closest<HTMLElement>('[data-field][data-value]');
          return { ref: formRef(choice), field: choice?.dataset.field ?? '', value: choice?.dataset.value ?? '' };
        },
      },
      {
        id: 'properties.item.input',
        label: 'Edit item property',
        group: 'properties',
        hidden: true,
        input: { on: 'input', selector: '.properties input[data-field]:not([type="checkbox"]), .properties textarea[data-field]' },
        payload: ({ target }) => ({
          ref: formRef(target),
          field: target?.getAttribute('data-field') ?? '',
          value: (target as HTMLInputElement | HTMLTextAreaElement).value,
        }),
      },
      {
        id: 'properties.item.select',
        label: 'Select item property',
        event: 'properties.item.input',
        group: 'properties',
        hidden: true,
        input: { on: 'change', selector: '.properties select[data-field]' },
        payload: ({ target }) => ({
          ref: formRef(target),
          field: target?.getAttribute('data-field') ?? '',
          value: (target as HTMLSelectElement).value,
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
      // Edit is an explicit reveal intent: a persisted collapsed workspace must
      // not make the command appear inert.
      if (!contexts.fold.isOpen('outline.panel')) contexts.fold.set('outline.panel', true);
      if (selected()?.kind !== ref.kind || selected()?.id !== ref.id) emit('selection.item.select', ref);
      emit('tool.panel.redraw', { id: 'properties' });
      queueMicrotask(() => inspectorRoot()?.querySelector<HTMLInputElement>('[data-item-modal-title]')?.focus());
    });
    on('properties.title.input', ({ ref, value }) => applyProperty(ref, ref.kind === 'edge' ? 'label' : 'title', value));
    on('properties.title.finish', ({ ref }) => {
      const title = inspectorRoot()?.querySelector<HTMLInputElement>('[data-item-modal-title]');
      const titleRef = itemRefFrom(title);
      if (titleRef?.kind === ref.kind && titleRef.id === ref.id) title?.blur();
    });
    on('properties.item.input', ({ ref, field, value }) => applyProperty(ref, field, value));
    on('properties.item.choice', ({ ref, field, value }) => {
      applyProperty(ref, field, value);
      inspectorRoot()?.querySelectorAll<HTMLElement>(`[data-field="${field}"][data-value]`).forEach(choice => {
        choice.setAttribute('aria-pressed', choice.dataset.value === value ? 'true' : 'false');
      });
    });
    on('properties.item.toggle', ({ ref, field, checked }) => applyProperty(ref, field, checked));
    on('properties.structure.axis', ({ ref, value }) => {
      applyProperty(ref, 'sectionAxis', value);
      inspectorRoot()?.querySelectorAll<HTMLElement>('[data-axis]').forEach(button => {
        const active = button.dataset.axis === value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });
    on('properties.sections.input', ({ ref, value }) => applyProperty(ref, 'sections', value));
    on('properties.group.toggle', ({ ref, group, open }) => {
      if (!group) return;
      const key = expandedGroupKey(ref, group);
      if (open) expandedGroups.add(key);
      else expandedGroups.delete(key);
      const advanced = [...(inspectorRoot()?.querySelectorAll<HTMLElement>('.property-advanced-group') ?? [])]
        .find(candidate => candidate.dataset.propertyGroup === group);
      if (advanced) {
        advanced.dataset.open = open ? 'true' : 'false';
        advanced.querySelector('.property-advanced-toggle')?.setAttribute('aria-expanded', open ? 'true' : 'false');
        const body = advanced.querySelector<HTMLElement>('.property-advanced-fields');
        if (body) body.hidden = !open;
      }
    });
    on('properties.sections.add', ({ ref }) => {
      const list = inspectorRoot()?.querySelector<HTMLElement>('[data-section-list]');
      if (!list) return;
      list.append(sectionRow(`Section ${list.children.length + 1}`, list.children.length));
      applyProperty(ref, 'sections', sectionValues(list).join('\n'));
      list.querySelectorAll<HTMLElement>('[data-section-row]').forEach((row, index) => { row.dataset.sectionRow = `${index}`; });
      list.lastElementChild?.querySelector<HTMLInputElement>('input')?.focus();
    });
    on('properties.sections.remove', ({ ref, index }) => {
      const list = inspectorRoot()?.querySelector<HTMLElement>('[data-section-list]');
      if (!list || list.children.length <= 1 || index < 0) return;
      list.children[index]?.remove();
      [...list.children].forEach((row, next) => {
        (row as HTMLElement).dataset.sectionRow = `${next}`;
        const order = row.querySelector('span');
        if (order) order.textContent = `${next + 1}`;
        const remove = row.querySelector<HTMLElement>('[data-section-index]');
        if (remove) remove.dataset.sectionIndex = `${next}`;
      });
      applyProperty(ref, 'sections', sectionValues(list).join('\n'));
    });
    on('selection.changed', () => {
      queueInspectorRedraw();
    });
    on('ink.stroke.completed', () => emit('tool.panel.redraw', { id: 'properties' }));
    on('ink.stroke.deleted', () => emit('tool.panel.redraw', { id: 'properties' }));
    on('graph.switched', () => {
      emit('tool.panel.redraw', { id: 'properties' });
    });
  }, { requires: ['ability.selectable', 'tool.panel'] });
}
