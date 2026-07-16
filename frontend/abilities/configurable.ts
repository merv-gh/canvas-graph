import { itemParentAttr, itemRefFrom, type Registry } from '../core';
import { Places, Slots } from '../types';
import type {
  Id,
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
    'properties.title.input': { ref: ItemRef; value: string };
    'properties.title.finish': { ref: ItemRef };
    'properties.structure.axis': { ref: ItemRef; value: string };
    'properties.sections.input': { ref: ItemRef; value: string };
    'properties.sections.add': { ref: ItemRef };
    'properties.sections.remove': { ref: ItemRef; index: number };
  }
}

type ContainerLike = {
  id: Id;
  Sections?: { id: Id; title: string }[];
  ChildSections?: Record<string, Id>;
};

const childKey = (ref: ItemRef) => `${ref.kind}:${ref.id}`;

/** Configurable — any entity with declared `properties` can have this. The
 *  properties modal is rendered from `EntityDef.properties` and dispatch
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
  system('ability.configurable', ({ on, emit, contexts, graphs, model, selection }) => {
    const formRef = (target?: Element | null): ItemRef =>
      itemRefFrom(target?.closest('.properties')) ?? { kind: 'node', id: '' };
    const item = (ref: ItemRef) => graphs.current.getItem(ref);
    const entityDef = (ref: ItemRef) => model.entity<unknown, unknown>(ref.kind);
    const sectionValues = (root: Element) => [...root.querySelectorAll<HTMLInputElement>('[data-section-input]')]
      .map(input => input.value.trim()).filter(Boolean);
    const actionButton = (label: string, command: string, icon: string, attrs: Record<string, string> = {}, active?: boolean) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `context-action context-action-card${active ? ' active' : ''}`;
      button.dataset.command = command;
      if (active !== undefined) button.setAttribute('aria-pressed', active ? 'true' : 'false');
      Object.entries(attrs).forEach(([key, value]) => { button.dataset[key] = value; });
      const glyph = document.createElement('span');
      glyph.className = 'context-action-icon';
      glyph.textContent = icon;
      const text = document.createElement('strong');
      text.textContent = label;
      button.append(glyph, text);
      return button;
    };
    const actionGroup = (title: string, children: HTMLElement[]) => {
      const group = document.createElement('section');
      group.className = 'context-action-group';
      const heading = document.createElement('h3');
      heading.textContent = title;
      const body = document.createElement('div');
      body.className = 'context-action-grid';
      body.append(...children);
      group.append(heading, body);
      return group;
    };
    const renderActions = (ref: ItemRef, current: unknown) => {
      const actions = document.createElement('section');
      actions.className = 'context-actions context-actions-combined';
      if (ref.kind === 'node') {
        const type = (current as { NodeType?: string }).NodeType ?? 'text';
        actions.append(actionGroup('Shape', [
          actionButton('Text', 'node.type.text', 'T', {}, type === 'text'),
          actionButton('Box', 'node.type.square', '□', {}, type === 'square'),
          actionButton('Circle', 'node.type.circle', '○', {}, type === 'circle'),
        ]));
      }
      if (ref.kind === 'edge') {
        actions.append(actionGroup('Connection', [
          actionButton('Reverse direction', 'graph.edge.reverse', '⇄'),
          actionButton('Delete connection', 'graph.edge.delete', '×'),
        ]));
      }
      if (ref.kind === 'container') {
        actions.append(actionGroup('Boundary', [
          actionButton('Ungroup, keep contents', 'container.ungroup', '⊟'),
          actionButton('Delete…', 'container.delete.request', '×'),
        ]));
      }
      const parent = contexts.hierarchy.parentRefOf(ref);
      const container = parent?.kind === 'container' ? graphs.current.getItem<ContainerLike>(parent) : null;
      if (parent?.kind === 'container' && container) {
        const placement = [actionButton('Move out', 'container.remove-child', '↗')];
        container.Sections?.forEach(section => {
          const active = container.ChildSections?.[childKey(ref)] === section.id;
          placement.push(actionButton(section.title, 'container.child.section.set', active ? '✓' : '→', {
            containerId: parent.id,
            childKind: ref.kind,
            childId: ref.id,
            sectionId: section.id,
          }, active));
        });
        actions.append(actionGroup('Placement', placement));
      }
      return actions;
    };
    const titleView = (ref: ItemRef, current: unknown) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'item-modal-title';
      const label = (current as { Label?: { text?: string } }).Label?.text?.trim();
      if (ref.kind === 'edge' && !label) {
        const edge = current as { From?: Id; To?: Id };
        const from = edge.From ? graphs.current.getNode(edge.From)?.Label.text : undefined;
        const to = edge.To ? graphs.current.getNode(edge.To)?.Label.text : undefined;
        input.value = from && to ? `${from} → ${to}` : 'Connection';
      } else {
        input.value = label || 'Untitled';
      }
      input.dataset.itemModalTitle = '';
      input.dataset.itemKind = ref.kind;
      input.dataset.itemId = ref.id;
      input.setAttribute('aria-label', 'Item title');
      input.autofocus = true;
      input.spellcheck = false;
      return input;
    };
    const sectionRow = (title = '', index = 0) => {
      const row = document.createElement('div');
      row.className = 'property-section-row';
      row.dataset.sectionRow = `${index}`;
      const order = document.createElement('span');
      order.textContent = `${index + 1}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = title;
      input.dataset.sectionInput = '';
      input.setAttribute('aria-label', `Section ${index + 1} name`);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.command = 'properties.sections.remove';
      remove.dataset.sectionIndex = `${index}`;
      remove.setAttribute('aria-label', `Remove section ${index + 1}`);
      remove.textContent = '×';
      row.append(order, input, remove);
      return row;
    };
    const renderContainerStructure = (ref: ItemRef, current: unknown, props: PropertyDef<unknown, unknown>[]) => {
      const structure = document.createElement('section');
      structure.className = 'property-structure-editor';
      const heading = document.createElement('header');
      heading.innerHTML = '<span>Container structure</span><small>Choose how named regions divide the container.</small>';
      const axisProp = props.find(prop => prop.id === 'sectionAxis');
      const axis = String(axisProp?.value(current) ?? 'rows');
      const axisRow = document.createElement('div');
      axisRow.className = 'property-axis-choice';
      ([['columns', '↔', 'Side by side'], ['rows', '↕', 'Stacked']] as const).forEach(([value, glyph, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = 'properties.structure.axis';
        button.dataset.axis = value;
        button.className = axis === value ? 'active' : '';
        button.setAttribute('aria-pressed', axis === value ? 'true' : 'false');
        button.innerHTML = `<b>${glyph}</b><span>${label}</span>`;
        axisRow.append(button);
      });
      const list = document.createElement('div');
      list.className = 'property-section-list';
      list.dataset.sectionList = '';
      const sections = (current as { Sections?: { title: string }[] }).Sections ?? [];
      (sections.length ? sections : [{ title: 'Section 1' }]).forEach((section, index) => list.append(sectionRow(section.title, index)));
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'property-section-add';
      add.dataset.command = 'properties.sections.add';
      add.textContent = '+ Add region';
      structure.append(heading, axisRow, list, add);
      structure.dataset.itemKind = ref.kind;
      structure.dataset.itemId = ref.id;
      return structure;
    };
    const renderProperties = (ref: ItemRef, current: unknown, properties: PropertyDef<unknown, unknown>[]) => {
      const form = contexts.templates.clone('properties');
      form.dataset.itemKind = ref.kind;
      form.dataset.itemId = ref.id;
      const parent = itemParentAttr(ref.parent);
      if (parent) form.dataset.itemParent = parent;
      const fields = contexts.templates.slot(form, 'fields');
      fields.append(renderActions(ref, current));
      const structureProps = ref.kind === 'container'
        ? properties.filter(prop => prop.id === 'sectionAxis' || prop.id === 'sections')
        : [];
      if (structureProps.length) fields.append(renderContainerStructure(ref, current, structureProps));
      const byGroup = new Map<string, PropertyDef<unknown, unknown>[]>();
      properties.filter(prop => !['title', 'width', 'height', ...(ref.kind === 'node' ? ['nodeType'] : []), ...(ref.kind === 'edge' ? ['label'] : [])].includes(prop.id) && !structureProps.includes(prop)).forEach(prop => {
        const group = prop.group ?? 'default';
        (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(prop);
      });
      byGroup.forEach((props, group) => {
        if (ref.kind === 'edge' && group !== 'default') {
          const details = document.createElement('details');
          details.className = 'property-advanced-group';
          const summary = document.createElement('summary');
          summary.textContent = group;
          const body = document.createElement('div');
          body.className = 'property-advanced-fields';
          props.forEach(prop => body.append(contexts.properties.render(prop, current)));
          details.append(summary, body);
          fields.append(details);
          return;
        }
        if (group !== 'default') {
          const heading = document.createElement('div');
          heading.className = 'property-group';
          heading.textContent = group;
          fields.append(heading);
        }
        props.forEach(prop => fields.append(contexts.properties.render(prop, current)));
      });
      const note = document.createElement('p');
      note.className = 'properties-autosave-note';
      note.textContent = 'Changes save automatically in this browser.';
      fields.append(note);
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
      emit('modal.open', {
        title: entity.label,
        titleView: titleView(ref, current),
        visual: 'properties',
        body: () => renderProperties(ref, current, properties),
      });
    });
    on('properties.title.input', ({ ref, value }) => applyProperty(ref, ref.kind === 'edge' ? 'label' : 'title', value));
    on('properties.title.finish', ({ ref }) => {
      const title = contexts.places.el(Places.Modal)?.querySelector<HTMLInputElement>('[data-item-modal-title]');
      const titleRef = itemRefFrom(title);
      if (titleRef?.kind === ref.kind && titleRef.id === ref.id) title?.blur();
    });
    on('properties.item.input', ({ ref, field, value }) => applyProperty(ref, field, value));
    on('properties.item.toggle', ({ ref, field, checked }) => applyProperty(ref, field, checked));
    on('properties.structure.axis', ({ ref, value }) => {
      applyProperty(ref, 'sectionAxis', value);
      contexts.places.el('modal')?.querySelectorAll<HTMLElement>('[data-axis]').forEach(button => {
        const active = button.dataset.axis === value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    });
    on('properties.sections.input', ({ ref, value }) => applyProperty(ref, 'sections', value));
    on('properties.sections.add', ({ ref }) => {
      const list = contexts.places.el('modal')?.querySelector<HTMLElement>('[data-section-list]');
      if (!list) return;
      list.append(sectionRow(`Section ${list.children.length + 1}`, list.children.length));
      applyProperty(ref, 'sections', sectionValues(list).join('\n'));
      list.querySelectorAll<HTMLElement>('[data-section-row]').forEach((row, index) => { row.dataset.sectionRow = `${index}`; });
      list.lastElementChild?.querySelector<HTMLInputElement>('input')?.focus();
    });
    on('properties.sections.remove', ({ ref, index }) => {
      const list = contexts.places.el('modal')?.querySelector<HTMLElement>('[data-section-list]');
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
    const closeDeletedInspector = (ref: ItemRef) => {
      const open = contexts.places.el('modal')?.querySelector<HTMLElement>('.properties');
      const openRef = itemRefFrom(open);
      if (openRef?.kind === ref.kind && openRef.id === ref.id) emit('modal.close');
    };
    on('graph.node.deleted', ({ id }) => closeDeletedInspector({ kind: 'node', id }));
    on('graph.edge.deleted', ({ id }) => closeDeletedInspector({ kind: 'edge', id }));
    on('container.deleted', ({ id }) => closeDeletedInspector({ kind: 'container', id }));
  }, { requires: ['ability.selectable', 'modal'] });
}
