import { collapsible, configurable, draggable, editable, nudgeable, resizeable, selectable } from '../abilities';
import { refKey } from '../core';
import { isNodeColor, type NodeColor } from '../model';
import { Slots } from '../types';
import type { EntityDef, EntityRenderer, Id, ItemRef, Position, PropertyDef, Rect, Size } from '../types';

export type SectionAxis = 'rows' | 'columns';
export type ContainerType = 'group' | 'c4-system' | 'c4-container';
export type ContainerSection = { id: Id; title: string; weight: number };
/** One legend row rendered inside the container: a color swatch + its meaning
 *  ("blue → Shared Expert"). Colors are NodeColor palette keys, same as node
 *  tints, so a legend always matches the nodes it explains. */
export type LegendEntry = { color: NodeColor; label: string };
export type Container = {
  id: Id;
  kind: 'container';
  Label: { text: string };
  Position: Position;
  Size: Size;
  AutoFit?: boolean;
  ContainerType?: ContainerType;
  Color?: NodeColor;
  Sections?: ContainerSection[];
  SectionAxis?: SectionAxis;
  ChildSections?: Record<string, Id>;
  Children: ItemRef[];
  Legend?: LegendEntry[];
  /** Repeat badge in the container corner ("3×"). Free text, empty = none. */
  Multiplier?: string;
};
export type ContainerPatch = Partial<Pick<Container, 'Label' | 'Position' | 'Size' | 'AutoFit' | 'ContainerType' | 'Color' | 'Sections' | 'SectionAxis' | 'ChildSections' | 'Legend' | 'Multiplier'>>;

export const DEFAULT_CONTAINER_SIZE: Size = { w: 320, h: 200 };
export const containerDefaultSize = (type?: ContainerType): Size => type === 'c4-system'
  ? { w: 560, h: 360 }
  : type === 'c4-container' ? { w: 400, h: 240 } : { ...DEFAULT_CONTAINER_SIZE };
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

/** One entry per line, `<color> <label>` ("blue Shared Expert"). Lines whose
 *  first token is not a palette color are dropped — bad snapshots or typos
 *  can't break render. */
export const parseLegend = (value: unknown): LegendEntry[] =>
  String(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .flatMap(line => {
      const [color, ...rest] = line.split(/\s+/);
      const label = rest.join(' ').trim();
      return isNodeColor(color) && label ? [{ color, label }] : [];
    });
export const sanitizeLegend = (entries: unknown): LegendEntry[] =>
  Array.isArray(entries)
    ? entries.filter((entry): entry is LegendEntry =>
      !!entry && isNodeColor((entry as LegendEntry).color) && typeof (entry as LegendEntry).label === 'string' && !!(entry as LegendEntry).label)
    : [];
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
      element.dataset.containerType = container.ContainerType ?? 'group';
      if (container.Color) element.dataset.containerColor = container.Color;
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
      if (!folded(container) && container.Legend?.length) {
        const legend = document.createElement('div');
        legend.className = 'container-legend';
        container.Legend.forEach(entry => {
          const row = document.createElement('div');
          row.className = 'container-legend-entry';
          const swatch = document.createElement('span');
          swatch.className = 'container-legend-swatch';
          swatch.dataset.legendColor = entry.color;
          const text = document.createElement('span');
          text.textContent = entry.label;
          row.append(swatch, text);
          legend.append(row);
        });
        element.append(legend);
      }
      if (container.Multiplier?.trim()) {
        const badge = document.createElement('div');
        badge.className = 'container-multiplier';
        badge.textContent = container.Multiplier.trim();
        element.append(badge);
      }
      const label = document.createElement('div');
      label.className = 'container-label';
      label.dataset.editableTitle = '';
      // Containers drag by their title bar only — the body belongs to the
      // nodes nested inside it.
      label.dataset.slot = Slots.Drag;
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
    { id: 'containerType', label: 'Container type', input: 'select', value: c => c.ContainerType ?? 'group',
      options: [{ value: 'group', label: 'Group' }, { value: 'c4-system', label: 'C4 system' }, { value: 'c4-container', label: 'C4 container' }],
      patch: (_c, value) => value === 'group' || value === 'c4-system' || value === 'c4-container' ? { ContainerType: value } : undefined },
    { id: 'sectionAxis', label: 'Section axis', input: 'select', group: 'Structure',
      options: [{ value: 'rows', label: 'Rows' }, { value: 'columns', label: 'Columns' }],
      value: c => c.SectionAxis ?? 'rows', patch: (_c, value) => validAxis(value) ? { SectionAxis: value } : undefined },
    { id: 'sections', label: 'Sections', input: 'textarea', rows: 4, group: 'Structure',
      value: c => c.Sections?.map(section => section.title).join('\n') ?? '',
      patch: (c, value) => ({ Sections: parseSections(value, c.Sections) }) },
    { id: 'legend', label: 'Legend (color label, one per line)', input: 'textarea', rows: 3, group: 'Structure',
      value: c => c.Legend?.map(entry => `${entry.color} ${entry.label}`).join('\n') ?? '',
      patch: (_c, value) => ({ Legend: parseLegend(value) }) },
    { id: 'multiplier', label: 'Repeat badge (e.g. 3×)', input: 'text', group: 'Structure',
      value: c => c.Multiplier ?? '',
      patch: (_c, value) => ({ Multiplier: String(value).trim() || undefined }) },
  ];

  return {
    kind: 'container', label: 'Container', labelOf: c => c.Label.text || c.id, order: -10,
    abilities: [selectable<Container>(), draggable<Container>(), nudgeable<Container>(), editable<Container>(),
      collapsible<Container>(), configurable<Container>(), resizeable<Container>()],
    properties,
    render,
  };
};
