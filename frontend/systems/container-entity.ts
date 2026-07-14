import { collapsible, configurable, draggable, editable, nudgeable, resizeable, selectable } from '../abilities';
import { refKey } from '../core';
import { Slots } from '../types';
import type { EntityDef, EntityRenderer, Id, ItemRef, Position, PropertyDef, Rect, Size } from '../types';

export type SectionAxis = 'rows' | 'columns';
export type ContainerSection = { id: Id; title: string; weight: number };
export type Container = {
  id: Id;
  kind: 'container';
  Label: { text: string };
  Position: Position;
  Size: Size;
  AutoFit?: boolean;
  Sections?: ContainerSection[];
  SectionAxis?: SectionAxis;
  ChildSections?: Record<string, Id>;
  Children: ItemRef[];
};
export type ContainerPatch = Partial<Pick<Container, 'Label' | 'Position' | 'Size' | 'AutoFit' | 'Sections' | 'SectionAxis' | 'ChildSections'>>;

export const DEFAULT_CONTAINER_SIZE: Size = { w: 320, h: 200 };
export const firstSectionId = (container: Container) => container.Sections?.[0]?.id;
export const sanitizeContainerSections = (container: Container) => {
  container.Sections = container.Sections?.map((section, index) => ({
    id: section.id || `s${index + 1}`,
    title: section.title || `Section ${index + 1}`,
    weight: Math.max(0.15, Number(section.weight) || 1),
  })) ?? [];
  container.SectionAxis = container.SectionAxis ?? 'rows';
  const valid = new Set(container.Sections.map(section => section.id));
  const children = new Set(container.Children.map(refKey));
  const fallback = firstSectionId(container);
  const next: Record<string, Id> = {};
  Object.entries(container.ChildSections ?? {}).forEach(([key, sectionId]) => {
    if (!children.has(key)) return;
    if (valid.has(sectionId)) next[key] = sectionId;
    else if (fallback) next[key] = fallback;
  });
  container.Children.forEach(child => {
    const key = refKey(child);
    if (fallback && !next[key]) next[key] = fallback;
  });
  container.ChildSections = next;
};

const parseSections = (value: unknown, existing: ContainerSection[] = []): ContainerSection[] =>
  String(value).split(/\r?\n/).map(title => title.trim()).filter(Boolean)
    .map((title, index) => ({ id: existing[index]?.id ?? `s${index + 1}`, title, weight: existing[index]?.weight ?? 1 }));
const validAxis = (value: unknown): value is SectionAxis => value === 'rows' || value === 'columns';

export const createContainerEntity = (
  visualRect: (container: Container | null) => Rect,
  folded: (container: Container) => boolean,
): EntityDef<Container, ContainerPatch> => {
  const render: EntityRenderer<Container> = {
    layer: 'html',
    bounds: visualRect,
    draw(container, renderer) {
      const rect = visualRect(container);
      const element = document.createElement('div');
      element.className = 'container';
      if (folded(container)) element.classList.add('collapsed');
      if (container.AutoFit === false) element.classList.add('manual');
      element.dataset.sectionAxis = container.SectionAxis ?? 'rows';
      element.style.left = `${rect.x + rect.w / 2}px`;
      element.style.top = `${rect.y + rect.h / 2}px`;
      element.style.width = `${rect.w}px`;
      element.style.height = `${rect.h}px`;
      const ref = renderer.refOf(container.id);
      renderer.tagItem(element, ref);
      renderer.applyItemModes(element, ref);
      if (!folded(container) && container.Sections?.length) {
        element.classList.add('has-sections');
        const sections = document.createElement('div');
        sections.className = 'container-sections';
        sections.dataset.axis = container.SectionAxis ?? 'rows';
        container.Sections.forEach((section, index) => {
          const band = document.createElement('div');
          band.className = 'container-section';
          band.dataset.sectionId = section.id;
          band.style.flexGrow = `${Math.max(0.15, section.weight ?? 1)}`;
          const title = document.createElement('span');
          title.dataset.containerSectionTitle = '';
          title.dataset.containerId = container.id;
          title.dataset.sectionId = section.id;
          title.tabIndex = 0;
          title.textContent = section.title;
          band.append(title);
          sections.append(band);
          if (index < container.Sections!.length - 1) {
            const divider = document.createElement('button');
            divider.type = 'button';
            divider.className = 'container-section-divider';
            divider.dataset.containerSectionResize = '';
            divider.dataset.containerId = container.id;
            divider.dataset.sectionIndex = `${index}`;
            divider.setAttribute('aria-label', 'Resize container sections');
            sections.append(divider);
          }
        });
        element.append(sections);
      }
      const label = document.createElement('div');
      label.className = 'container-label';
      label.dataset.editableTitle = '';
      label.textContent = container.Label.text;
      const handle = document.createElement('div');
      handle.className = 'container-resize';
      handle.dataset.slot = Slots.Resize;
      element.append(label, handle);
      renderer.wireAffordances(element);
      return element;
    },
  };

  const properties: PropertyDef<Container, ContainerPatch>[] = [
    { id: 'title', label: 'Title', input: 'text', value: c => c.Label.text,
      patch: (_c, value) => ({ Label: { text: String(value) } }) },
    { id: 'width', label: 'Width', input: 'number', min: 120, step: 8, value: c => c.Size.w,
      patch: (c, value) => Number.isFinite(Number(value)) ? { Size: { ...c.Size, w: Math.max(120, Number(value)) } } : undefined },
    { id: 'height', label: 'Height', input: 'number', min: 80, step: 8, value: c => c.Size.h,
      patch: (c, value) => Number.isFinite(Number(value)) ? { Size: { ...c.Size, h: Math.max(80, Number(value)) } } : undefined },
    { id: 'sectionAxis', label: 'Section axis', input: 'select', group: 'Structure',
      options: [{ value: 'rows', label: 'Rows' }, { value: 'columns', label: 'Columns' }],
      value: c => c.SectionAxis ?? 'rows', patch: (_c, value) => validAxis(value) ? { SectionAxis: value } : undefined },
    { id: 'sections', label: 'Sections', input: 'textarea', rows: 4, group: 'Structure',
      value: c => c.Sections?.map(section => section.title).join('\n') ?? '',
      patch: (c, value) => ({ Sections: parseSections(value, c.Sections) }) },
  ];

  return {
    kind: 'container', label: 'Container', labelOf: c => c.Label.text || c.id, order: -10,
    abilities: [selectable<Container>(), draggable<Container>(), nudgeable<Container>(), editable<Container>(),
      collapsible<Container>(), configurable<Container>(), resizeable<Container>()],
    properties,
    render,
  };
};
