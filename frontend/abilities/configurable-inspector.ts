import { iconNode, itemParentAttr, setIcon, type AppCtx, type SystemCtx } from '../core';
import { Places } from '../types';
import type { IconName, Id, ItemRef, PropertyDef, PropertyValue } from '../types';

type ContainerLike = {
  id: Id;
  Sections?: { id: Id; title: string }[];
  ChildSections?: Record<string, Id>;
};

const childKey = (ref: ItemRef) => `${ref.kind}:${ref.id}`;

type PropertiesInspectorDependencies = {
  contexts: AppCtx['contexts'];
  entityDef: (ref: ItemRef) => ReturnType<AppCtx['model']['entity']>;
  expandedGroupKey: (ref: ItemRef, group: string) => string;
  expandedGroups: Set<string>;
  graphs: AppCtx['graphs'];
  item: (ref: ItemRef) => unknown;
  model: AppCtx['model'];
  selection: AppCtx['selection'];
  emit: SystemCtx['emit'];
};

export const createPropertiesInspector = ({
  contexts,
  entityDef,
  expandedGroupKey,
  expandedGroups,
  graphs,
  item,
  model,
  selection,
  emit,
}: PropertiesInspectorDependencies) => {
    const actionButton = (label: string, command: string, icon: IconName, attrs: Record<string, string> = {}, active?: boolean) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `context-action context-action-card${active ? ' active' : ''}`;
      if (command.includes('delete')) button.classList.add('danger');
      button.dataset.command = command;
      button.setAttribute('aria-label', label);
      if (active !== undefined) button.setAttribute('aria-pressed', active ? 'true' : 'false');
      Object.entries(attrs).forEach(([key, value]) => { button.dataset[key] = value; });
      const glyph = document.createElement('span');
      glyph.className = 'context-action-icon';
      glyph.append(iconNode(icon));
      const text = document.createElement('span');
      text.className = 'context-action-label';
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
      if (children.some(child => child.classList.contains('danger'))) group.classList.add('danger');
      group.append(heading, body);
      return group;
    };
    const renderActions = (ref: ItemRef, current: unknown) => {
      const actions = document.createElement('section');
      actions.className = 'context-actions context-actions-combined';
      if (ref.kind === 'node') {
        const type = (current as { NodeType?: string }).NodeType ?? 'text';
        const itemActions = [
          actionButton('Convert to container', 'node.convert.container', 'container'),
          actionButton('Group', 'selection.group', 'group'),
        ];
        if (graphs.current.itemsOfKind('ink').length) itemActions.unshift(actionButton('Select drawings', 'ink.select.all', 'draw'));
        if (type === 'toggle') itemActions.unshift(actionButton(
          (current as { ToggleState?: boolean }).ToggleState ? 'Turn off' : 'Turn on',
          'node.toggle.state', 'toggle',
        ));
        if (contexts.commands.get('palette.custom-type.create')) itemActions.push(
          actionButton('Save as type', 'palette.custom-type.create', 'star'));
        actions.append(actionGroup(`Selected ${model.nodeType(type)?.label ?? type}`, itemActions));
        actions.append(actionGroup('Danger', [actionButton('Delete', 'selection.item.delete', 'trash')]));
      }
      if (ref.kind === 'edge') {
        actions.append(actionGroup('Connection', [actionButton('Reverse direction', 'graph.edge.reverse', 'reverse')]));
        actions.append(actionGroup('Danger', [actionButton('Delete connection', 'graph.edge.delete', 'trash')]));
      }
      if (ref.kind === 'container') {
        const boundaryActions = [
          actionButton('Convert to node', 'container.convert.node', 'node'),
          actionButton('Fold / unfold', 'item.collapse.toggle', 'collapse'),
        ];
        const currentContainer = graphs.current.getItem<{ Children?: ItemRef[] }>(ref);
        if (currentContainer?.Children?.length) {
          boundaryActions.unshift(actionButton('Ungroup, keep contents', 'container.ungroup', 'ungroup'));
        }
        actions.append(actionGroup('Boundary', boundaryActions));
        actions.append(actionGroup('Danger', [actionButton('Delete…', 'container.delete.request', 'trash')]));
      }
      const parent = contexts.hierarchy.parentRefOf(ref);
      const container = parent?.kind === 'container' ? graphs.current.getItem<ContainerLike>(parent) : null;
      if (parent?.kind === 'container' && container) {
        const placement = [actionButton('Move out', 'container.remove-child', 'move-out')];
        container.Sections?.forEach(section => {
          const active = container.ChildSections?.[childKey(ref)] === section.id;
          placement.push(actionButton(section.title, 'container.child.section.set', active ? 'check' : 'move-out', {
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
        const endpointLabel = (id?: Id) => {
          const endpointRef = id ? graphs.current.refById(id) : undefined;
          return endpointRef ? graphs.current.getItem<{ Label?: { text?: string } }>(endpointRef)?.Label?.text : undefined;
        };
        const from = endpointLabel(edge.From);
        const to = endpointLabel(edge.To);
        input.value = from && to ? `${from} → ${to}` : 'Connection';
      } else {
        input.value = label || 'Untitled';
      }
      input.dataset.itemModalTitle = '';
      input.dataset.itemKind = ref.kind;
      input.dataset.itemId = ref.id;
      input.setAttribute('aria-label', 'Item title');
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
      setIcon(remove, 'trash');
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
      ([['columns', 'layout-columns', 'Side by side'], ['rows', 'layout-rows', 'Stacked']] as const).forEach(([value, icon, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = 'properties.structure.axis';
        button.dataset.axis = value;
        button.className = axis === value ? 'active' : '';
        button.setAttribute('aria-pressed', axis === value ? 'true' : 'false');
        const visual = document.createElement('b');
        visual.append(iconNode(icon));
        const text = document.createElement('span');
        text.textContent = label;
        button.append(visual, text);
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
      const structureProps = ref.kind === 'container'
        ? properties.filter(prop => prop.id === 'sectionAxis' || prop.id === 'sections')
        : [];
      if (structureProps.length) fields.append(renderContainerStructure(ref, current, structureProps));
      const byGroup = new Map<string, PropertyDef<unknown, unknown>[]>();
      properties.filter(prop => ![
        'title', 'width', 'height',
        ...(ref.kind === 'node' ? ['nodeType', 'color', 'fill', 'borderColor'] : []),
        ...(ref.kind === 'edge' ? ['label', 'color'] : []),
      ].includes(prop.id) && !structureProps.includes(prop)).forEach(prop => {
        const group = prop.group ?? 'default';
        (byGroup.get(group) ?? byGroup.set(group, []).get(group)!).push(prop);
      });
      byGroup.forEach((props, group) => {
        if (group !== 'default') {
          const advanced = document.createElement('section');
          advanced.className = 'property-advanced-group';
          advanced.dataset.propertyGroup = group;
          const open = expandedGroups.has(expandedGroupKey(ref, group));
          advanced.dataset.open = open ? 'true' : 'false';
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'property-advanced-toggle';
          toggle.dataset.command = 'properties.group.toggle';
          toggle.textContent = group;
          toggle.setAttribute('aria-label', `Toggle ${group} properties`);
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          const body = document.createElement('div');
          body.className = 'property-advanced-fields';
          body.hidden = !open;
          props.forEach(prop => body.append(contexts.properties.render(prop, current)));
          advanced.append(toggle, body);
          fields.append(advanced);
          return;
        }
        props.forEach(prop => fields.append(contexts.properties.render(prop, current)));
      });
      fields.append(renderActions(ref, current));
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
    let inspectorRedrawQueued = false;
    const queueInspectorRedraw = () => {
      if (inspectorRedrawQueued) return;
      inspectorRedrawQueued = true;
      queueMicrotask(() => {
        inspectorRedrawQueued = false;
        emit('tool.panel.redraw', { id: 'properties' });
      });
    };
    const inspectorRoot = () => contexts.places.el(Places.Left)
      ?.querySelector<HTMLElement>('[data-panel-id="properties"]');
    const inspectable = () => {
      const ref = selected();
      if (!ref) return undefined;
      const current = item(ref);
      const entity = entityDef(ref);
      const properties = entity?.properties ?? [];
      if (!current || !entity || !properties.length) return undefined;
      return { ref, current, entity, properties };
    };
    const renderInspector = () => {
      const target = inspectable();
      if (!target) return document.createElement('div');
      const root = document.createElement('aside');
      root.className = 'properties-inspector';
      root.setAttribute('aria-label', `${target.entity.label} properties`);
      const header = document.createElement('header');
      header.className = 'properties-context-header';
      const kind = document.createElement('span');
      const nodeType = target.ref.kind === 'node'
        ? model.nodeType((target.current as { NodeType?: string }).NodeType ?? 'text')?.label
        : undefined;
      kind.textContent = `Properties · ${nodeType ?? target.entity.label}`;
      header.append(kind, titleView(target.ref, target.current));
      const scroll = document.createElement('div');
      scroll.className = 'properties-inspector-scroll';
      scroll.dataset.nativeScroll = '';
      scroll.append(header, renderProperties(target.ref, target.current, target.properties));
      const note = document.createElement('p');
      note.className = 'properties-autosave-note';
      note.textContent = 'Changes save automatically';
      root.append(scroll, note);
      return root;
    };
    return {
      applyProperty,
      inspectable,
      inspectorRoot,
      queueInspectorRedraw,
      renderInspector,
      sectionRow,
      selected,
    };
};

