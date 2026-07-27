import { clientPoint, edgeRef, itemRefFrom, nodeRef, setIcon, type Registry } from '../core';
import {
  EDGE_KINDS,
  isEdgeKind,
  isNodeColor,
  isNodeFill,
  NODE_COLORS,
  NODE_FILLS,
  BUILTIN_NODE_TYPES,
  isDefaultNodeSize,
  nodeTypeDefinition,
  nodeTypeLabel,
  type EdgeKind,
  type EdgePatch,
  type NodeBorder,
  type NodeColor,
  type NodeFill,
  type NodePatch,
  type NodeType,
} from '../model';
import { Places, type ItemRef } from '../types';
import type { ContainerType } from './container-entity';
import {
  activePresetId,
  allPresets,
  CUSTOM_TYPE_FORMS,
  getPreset,
  typeEntriesFor,
  type PresetId,
  type PresetTypeEntry,
} from './presets';

declare module '../types' {
  interface CustomEvents {
    'palette.arm.entry': { preset: PresetId; index: number };
    'palette.arm.type': { type: NodeType };
    'palette.arm.color': { color?: NodeColor };
    'palette.arm.fill': { fill: NodeFill };
    'palette.arm.border': { border?: NodeBorder };
    'palette.edge.kind': { kind: EdgeKind };
    'palette.arm.changed': { type: NodeType; color?: NodeColor; fill?: NodeFill; border?: NodeBorder; entity?: 'node' | 'container'; containerType?: ContainerType; label?: string; entryIndex?: number; entryId?: string };
    'palette.custom-type.delete.request': { preset: PresetId; entryId: string };
    'palette.custom-type.delete.confirm': void;
    'palette.node.place': { point: { x: number; y: number }; containerId?: string };
    'palette.place.item': { ref: ItemRef; point: { x: number; y: number }; client: { x: number; y: number } };
    'palette.place.activate': void;
    'palette.place.cancel': void;
    'palette.mobile.toggle': void;
    'palette.mobile.close': void;
    'palette.mobile.tab': { shift: boolean };
    'palette.category.set': { category: string };
    'palette.favorite.toggle': { key: string };
  }
}

export type PaletteArm = {
  type: NodeType;
  color?: NodeColor;
  fill?: NodeFill;
  border?: NodeBorder;
  entity?: 'node' | 'container';
  containerType?: ContainerType;
  label?: string;
  entryIndex?: number;
  entryId?: string;
  entryPreset?: PresetId;
};

type CatalogItem = {
  entry: PresetTypeEntry;
  index: number;
  preset: PresetId;
  category: string;
  keywords: string[];
  command: string;
};
type CatalogRef = Pick<CatalogItem, 'index' | 'preset' | 'command'> & { type: NodeType };

const FAVORITES_KEY = 'palette:favorites';
const RECENT_KEY = 'palette:recent';
const catalogRefKey = (ref: CatalogRef) => `${ref.command}|${ref.preset}|${ref.index}|${ref.type}`;

const SWATCH_CLASS: Record<NodeColor, string> = {
  gray: 'gray', red: 'red', orange: 'orange', yellow: 'yellow',
  green: 'green', blue: 'blue', purple: 'purple', pink: 'pink',
};

const button = (command: string, label: string, text = '') => {
  const el = document.createElement('button');
  el.type = 'button';
  el.dataset.command = command;
  el.setAttribute('aria-label', label);
  el.title = label;
  el.textContent = text;
  return el;
};

const block = (title: string) => {
  const el = document.createElement('section');
  el.className = 'palette-block';
  const heading = document.createElement('h3');
  heading.textContent = title;
  el.append(heading);
  return el;
};

const typeLabel = (entry: PresetTypeEntry) => entry.label ?? nodeTypeLabel(entry.value);
const sameVisualEntry = (a: PresetTypeEntry, b: PresetTypeEntry) =>
  a.value === b.value && a.color === b.color && a.fill === b.fill && a.border === b.border
  && a.entity === b.entity && a.containerType === b.containerType;

export function registerPalette(system: Registry) {
  system('palette', ({ on, emit, contexts, graphs, io, selection, declarePanel, contribute, origin, frameLoop }) => {
    let placing = false;
    let mobileOpen = false;
    let mobileRestoreFocus: HTMLElement | null = null;
    let redrawPending = false;
    let disposed = false;
    let pendingDelete: { preset: PresetId; entryId: string } | null = null;
    let drawing = false;
    let erasing = false;
    let inkArm = { color: 'pink' as NodeColor, width: 3, opacity: 1 };
    let search = '';
    let category = 'All';
    const storedRefs = (key: string) => io.get<unknown[]>(key, []).flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const ref = value as Partial<CatalogRef>;
      return typeof ref.command === 'string' && typeof ref.preset === 'string'
        && Number.isInteger(ref.index) && typeof ref.type === 'string'
        ? [ref as CatalogRef] : [];
    });
    let favorites = storedRefs(FAVORITES_KEY);
    let recent = storedRefs(RECENT_KEY);
    const remember = (ref: CatalogRef) => {
      const key = catalogRefKey(ref);
      recent = [ref, ...recent.filter(candidate => catalogRefKey(candidate) !== key)].slice(0, 6);
      io.set(RECENT_KEY, recent);
    };
    const presetId = (): PresetId => activePresetId(io, graphs.current.id);
    const defaultArm = (): PaletteArm => {
      const entries = typeEntriesFor(io, presetId());
      const preferred = getPreset(io, presetId())?.defaultNodeType ?? entries[0]?.value ?? 'text';
      const entryIndex = Math.max(0, entries.findIndex(candidate => candidate.value === preferred));
      const entry = entries[entryIndex] ?? entries[0];
      return {
        type: entry?.value ?? 'text', color: entry?.color, fill: entry?.fill,
        border: entry?.border,
        entity: entry?.entity, containerType: entry?.containerType, label: entry ? typeLabel(entry) : undefined,
        entryIndex, entryId: entry?.id,
      };
    };
    let arm = defaultArm();

    const redraw = () => {
      if (redrawPending) return;
      redrawPending = true;
      queueMicrotask(() => {
        redrawPending = false;
        if (!disposed) emit('tool.panel.redraw', { id: 'palette' });
      });
    };
    const setMobileOpen = (next: boolean) => {
      if (mobileOpen === next) return;
      if (next) mobileRestoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      mobileOpen = next;
      redraw();
      frameLoop.schedule('palette.mobile.focus.prepare', () => {
        frameLoop.schedule('palette.mobile.focus.commit', () => {
          if (mobileOpen) {
            contexts.places.el(Places.Left)?.querySelector<HTMLElement>('.palette-mobile-close')?.focus({ preventScroll: true });
            return;
          }
          const target = mobileRestoreFocus;
          mobileRestoreFocus = null;
          if (target?.isConnected) target.focus({ preventScroll: true });
          else contexts.places.el(Places.Left)?.querySelector<HTMLElement>('.palette-mobile-toggle')?.focus({ preventScroll: true });
        }, 45);
      }, 45);
    };
    const stageEl = () => contexts.places.el(Places.Stage);
    const setPlacement = (active: boolean) => {
      const changedMode = placing !== active;
      placing = active;
      stageEl()?.classList.toggle('node-placing', active);
      redraw();
      if (changedMode) emit('tool.panel.redraw', { id: 'top' });
    };
    const selectedRefs = () => selection.selectedAll();
    const selectedNodes = () => selectedRefs().filter(ref => ref.kind === 'node');
    const selectedEdges = () => selectedRefs().filter(ref => ref.kind === 'edge');
    const selectedContainers = () => selectedRefs().filter(ref => ref.kind === 'container');
    const updateSelectedNodes = (patchFor: (id: string) => NodePatch) => {
      selectedNodes().forEach(ref => emit('item.update', { ref: nodeRef(ref.id), patch: patchFor(ref.id) }));
    };
    const updateSelectedEdges = (patch: EdgePatch) => {
      selectedEdges().forEach(ref => emit('item.update', { ref: edgeRef(ref.id), patch }));
    };
    const updateSelectedContainers = (patch: { ContainerType?: ContainerType; Color?: NodeColor }) => {
      selectedContainers().forEach(ref => emit('item.update', { ref, patch }));
    };
    const setArm = (entry: PresetTypeEntry, entryIndex: number, entryPreset = presetId()) => {
      arm = {
        ...arm, type: entry.value, color: entry.color, fill: entry.fill, border: entry.border,
        entity: entry.entity, containerType: entry.containerType, label: typeLabel(entry),
        entryIndex, entryId: entry.id, entryPreset,
      };
    };
    const activateArm = () => {
      if (drawing) emit('ink.toggle');
      if (erasing) emit('ink.erase.toggle');
      setPlacement(true);
      changed();
    };
    const deepestContainerAt = ({ x, y }: { x: number; y: number }) => {
      const stage = stageEl();
      if (!stage) return undefined;
      return [...stage.querySelectorAll<HTMLElement>('.container[data-item-id]')]
        .filter(element => {
          const rect = element.getBoundingClientRect();
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        })
        .map(element => {
          const ref = itemRefFrom(element);
          const rect = element.getBoundingClientRect();
          return ref?.kind === 'container'
            ? { id: ref.id, depth: contexts.hierarchy.parentChain(ref).length, area: rect.width * rect.height }
            : null;
        })
        .filter((candidate): candidate is { id: string; depth: number; area: number } => !!candidate)
        .sort((a, b) => b.depth - a.depth || a.area - b.area)[0]?.id;
    };
    const placeArmed = (point: { x: number; y: number }, containerId?: string) => {
      if (arm.entity === 'container') {
        const sameType = graphs.current.itemsOfKind<{ ContainerType?: ContainerType }>('container')
          .filter(container => container.ContainerType === arm.containerType).length;
        if (containerId) {
          const off = on('container.created', ({ id }) => {
            off();
            emit('container.add-child', { containerId, childRef: { kind: 'container', id } });
          });
        }
        emit('editing.container.create', {
          Label: { text: `${arm.label ?? 'Container'} ${sameType + 1}` },
          at: point,
          ContainerType: arm.containerType,
          Color: arm.color,
        });
        return;
      }
      const size = nodeTypeDefinition(arm.type)?.defaultSize;
      if (containerId) {
        const off = on('graph.node.created', ({ id }) => {
          off();
          emit('container.add-child', { containerId, childRef: nodeRef(id) });
        });
      }
      emit('graph.node.create', {
        Label: { text: arm.label ?? `Node ${graphs.current.nodes().length + 1}` },
        Position: point,
        NodeType: arm.type,
        Color: arm.color,
        Fill: arm.fill,
        BorderColor: arm.border,
        ...(size ? { Size: size } : {}),
        keepView: true,
      });
    };
    const applyEntry = (entry: PresetTypeEntry, entryIndex: number, entryPreset = presetId()) => {
      const entries = typeEntriesFor(io, entryPreset);
      const needsLabelIdentity = entryPreset === 'jira'
        || entries.some((candidate, index) => index !== entryIndex && sameVisualEntry(candidate, entry));
      setArm(entry, entryIndex, entryPreset);
      if (entry.entity === 'container') {
        if (selectedNodes().length) {
          emit('selection.group.as', { label: typeLabel(entry), containerType: entry.containerType, color: entry.color });
        } else if (selectedContainers().length) {
          updateSelectedContainers({ ContainerType: entry.containerType, Color: entry.color });
        }
      } else {
        updateSelectedNodes(id => {
          const node = graphs.current.getNode(id);
          const patch: NodePatch = {
            NodeType: arm.type, Color: arm.color, Fill: arm.fill, BorderColor: arm.border,
            ...(needsLabelIdentity ? { Label: { text: typeLabel(entry) } } : {}),
          };
          const size = nodeTypeDefinition(arm.type)?.defaultSize;
          if (node && size && (arm.type === 'operator' || arm.type === 'diamond' || isDefaultNodeSize(node.Size))) patch.Size = size;
          return patch;
        });
      }
      activateArm();
    };
    const changed = () => {
      emit('palette.arm.changed', { ...arm });
      redraw();
    };
    const reset = () => { arm = defaultArm(); changed(); };
    const primaryNode = () => {
      const ref = selection.selected();
      return ref?.kind === 'node' ? graphs.current.getNode(ref.id) : undefined;
    };
    const primaryEdge = () => {
      const ref = selection.selected();
      return ref?.kind === 'edge' ? graphs.current.getEdge(ref.id) : undefined;
    };
    const primaryContainer = () => {
      const ref = selection.selected();
      return ref?.kind === 'container'
        ? graphs.current.getItem<{ ContainerType?: ContainerType; Color?: NodeColor }>(ref)
        : undefined;
    };

    const typeCommands = BUILTIN_NODE_TYPES.map(def => def.id);
    contexts.commands.register([
      {
        id: 'palette.arm.entry', label: 'Arm collection type', event: 'palette.arm.entry',
        group: 'palette', hidden: true,
        payload: ({ target }) => {
          const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-palette-index]');
          return { preset: el?.dataset.palettePreset ?? '', index: Number(el?.dataset.paletteIndex ?? -1) };
        },
      },
      {
        id: 'palette.custom-type.create', label: 'Create custom palette type', event: 'preset.type.register',
        group: 'palette',
        form: {
          title: 'New palette type', submitLabel: 'Save and use', shouldOpen: () => true,
          fields: [
            { id: 'label', label: 'Type name', placeholder: 'Critical service', autofocus: true },
            { id: 'shape', label: 'Form', input: 'select', options: () => CUSTOM_TYPE_FORMS },
            { id: 'color', label: 'Color', input: 'select', options: () => [
              { value: 'automatic', label: 'Automatic' }, ...NODE_COLORS,
            ] },
            { id: 'fill', label: 'Fill', input: 'select', options: () => NODE_FILLS },
            { id: 'border', label: 'Border', input: 'select', options: () => [
              { value: 'automatic', label: 'Match color' }, { value: 'none', label: 'None' }, ...NODE_COLORS,
            ] },
          ],
          seed: () => {
            const node = primaryNode();
            const shape = node?.NodeType ?? arm.type;
            return {
              label: node?.Label.text ?? '',
              shape: CUSTOM_TYPE_FORMS.some(option => option.value === shape) ? shape : 'rounded',
              color: node?.Color ?? arm.color ?? 'automatic',
              fill: node?.Fill ?? arm.fill ?? 'soft',
              border: node?.BorderColor ?? arm.border ?? 'automatic',
            };
          },
          validate: values => {
            if (!values.label?.trim()) return 'Give this type a name.';
            if (values.label.trim().length > 48) return 'Type names can be up to 48 characters.';
            if (!CUSTOM_TYPE_FORMS.some(option => option.value === values.shape)) return 'Choose a valid form.';
            if (values.color !== 'automatic' && !isNodeColor(values.color)) return 'Choose a valid color.';
            if (!isNodeFill(values.fill)) return 'Choose a valid fill.';
            if (values.border !== 'automatic' && values.border !== 'none' && !isNodeColor(values.border)) return 'Choose a valid border.';
          },
          payload: values => {
            const label = values.label.trim();
            const slug = label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'type';
            return {
              preset: presetId(),
              entry: {
                id: `custom-${Date.now().toString(36)}-${slug}`,
                label,
                value: values.shape as NodeType,
                color: values.color === 'automatic' ? undefined : values.color as NodeColor,
                fill: values.fill as NodeFill,
                border: values.border === 'automatic' ? undefined : values.border as NodeBorder,
              },
            };
          },
        },
      },
      {
        id: 'palette.custom-type.rename', label: 'Rename custom palette type', event: 'preset.type.rename',
        group: 'palette', hidden: true,
        payload: ({ target }) => {
          const control = target?.closest<HTMLElement>('[data-custom-type-id]');
          return {
            preset: control?.dataset.customTypePreset ?? '',
            entryId: control?.dataset.customTypeId ?? '',
            label: control?.dataset.customTypeLabel ?? '',
          };
        },
        form: {
          title: 'Rename palette type', submitLabel: 'Rename',
          shouldOpen: payload => !!(payload as { entryId?: string } | undefined)?.entryId,
          fields: [
            { id: 'preset', label: '', input: 'hidden' },
            { id: 'entryId', label: '', input: 'hidden' },
            { id: 'label', label: 'Type name', autofocus: true },
          ],
          seed: payload => payload as Record<string, string>,
          validate: values => {
            if (!values.label?.trim()) return 'Give this type a name.';
            if (values.label.trim().length > 48) return 'Type names can be up to 48 characters.';
          },
          payload: values => ({
            preset: values.preset,
            entryId: values.entryId,
            label: values.label.trim(),
          }),
        },
      },
      {
        id: 'palette.custom-type.delete.request', label: 'Delete custom palette type',
        group: 'palette', hidden: true,
        payload: ({ target }) => {
          const control = target?.closest<HTMLElement>('[data-custom-type-id]');
          return { preset: control?.dataset.customTypePreset ?? '', entryId: control?.dataset.customTypeId ?? '' };
        },
      },
      {
        id: 'palette.custom-type.delete.confirm', label: 'Confirm custom palette type deletion',
        group: 'palette', hidden: true,
      },
      {
        id: 'palette.place.activate', label: 'Add node using selected catalog type', group: 'palette',
      },
      {
        id: 'palette.node.place', label: 'Place armed item', group: 'palette', hidden: true,
        input: {
          on: 'click', selector: `[data-place="${Places.Stage}"]`, prevent: true,
          when: (event, stage) => {
            if (!placing || drawing || erasing) return false;
            const target = event.target;
            return target === stage || (target instanceof Element && stage.contains(target)
              && !target.closest('[data-item-id], .tool-panel, .item-toolbar, .modal-layer'));
          },
        },
        payload: ({ event }) => ({ point: contexts.view.clientToSpace(Places.Stage, clientPoint(event!)) }),
      },
      {
        id: 'palette.place.item', label: 'Resolve an item click while adding', group: 'palette', hidden: true,
        input: {
          on: 'pointerdown', selector: '[data-item-kind][data-item-id]', prevent: true, stop: true,
          when: event => placing && !drawing && !erasing
            && (event as PointerEvent).button === 0
            && !(event.target as Element).closest('.tool-panel, .item-toolbar, .modal-layer, [data-command], input, textarea, select'),
        },
        payload: ({ event, target }) => {
          const ref = itemRefFrom(target);
          const client = clientPoint(event!);
          return ref ? { ref, client, point: contexts.view.clientToSpace(Places.Stage, client) } : undefined;
        },
      },
      { id: 'palette.place.cancel', label: 'Stop placing nodes', group: 'palette', hidden: true },
      ...typeCommands.map(type => ({
        id: `palette.arm.type.${type}`,
        label: `Arm node type: ${nodeTypeLabel(type)}`,
        event: 'palette.arm.type' as const,
        group: 'palette',
        available: () => !!nodeTypeDefinition(type),
        payload: () => ({ type }),
      })),
      ...NODE_COLORS.map(({ value, label }) => ({
        id: `palette.arm.color.${value}`,
        label: `Arm node color: ${label}`,
        event: 'palette.arm.color' as const,
        group: 'palette',
        payload: () => ({ color: value }),
      })),
      {
        id: 'palette.arm.color.default', label: 'Arm node color: collection default',
        event: 'palette.arm.color', group: 'palette', payload: () => ({ color: undefined }),
      },
      ...NODE_FILLS.map(({ value, label }) => ({
        id: `palette.arm.fill.${value}`,
        label: `Arm node fill: ${label}`,
        event: 'palette.arm.fill' as const,
        group: 'palette',
        payload: () => ({ fill: value }),
      })),
      ...NODE_COLORS.map(({ value, label }) => ({
        id: `palette.arm.border.${value}`,
        label: `Arm node border: ${label}`,
        event: 'palette.arm.border' as const,
        group: 'palette',
        payload: () => ({ border: value }),
      })),
      {
        id: 'palette.arm.border.none', label: 'Arm node border: none',
        event: 'palette.arm.border', group: 'palette', payload: () => ({ border: 'none' as const }),
      },
      {
        id: 'palette.arm.border.default', label: 'Arm node border: automatic',
        event: 'palette.arm.border', group: 'palette', payload: () => ({ border: undefined }),
      },
      ...EDGE_KINDS.map(({ value, label }) => ({
        id: `palette.edge.kind.${value}`,
        label: `Set selected edge kind: ${label}`,
        event: 'palette.edge.kind' as const,
        group: 'palette',
        available: () => selectedEdges().length > 0,
        payload: () => ({ kind: value }),
      })),
      {
        id: 'palette.category.set', label: 'Filter node type category', group: 'palette', hidden: true,
        payload: ({ target }) => ({ category: (target as HTMLElement).closest<HTMLElement>('[data-palette-category]')?.dataset.paletteCategory ?? 'All' }),
      },
      {
        id: 'palette.favorite.toggle', label: 'Toggle favorite node type', group: 'palette', hidden: true,
        payload: ({ target }) => ({ key: target?.closest<HTMLElement>('[data-palette-favorite]')?.dataset.paletteFavorite ?? '' }),
      },
      { id: 'palette.mobile.toggle', label: 'Toggle node palette', group: 'palette', hidden: true },
      { id: 'palette.mobile.close', label: 'Close node palette', group: 'palette', hidden: true },
    ]);

    const pressed = (el: HTMLButtonElement, active: boolean) =>
      el.setAttribute('aria-pressed', active ? 'true' : 'false');

    const categoryTabs = () => {
      const wrap = document.createElement('div');
      wrap.className = 'palette-catalog-search';
      const categories = document.createElement('div');
      categories.className = 'palette-category-tabs';
      for (const name of ['All', 'Favorites', ...new Set(BUILTIN_NODE_TYPES.map(def => def.category))]) {
        const choice = button('palette.category.set', `Show ${name} node types`, name);
        choice.dataset.paletteCategory = name;
        pressed(choice, category === name);
        categories.append(choice);
      }
      wrap.append(categories);
      return wrap;
    };

    const matches = (entry: PresetTypeEntry, categoryName = '', keywords: string[] = []) => {
      const categoryMatch = category === 'All' || category === categoryName;
      const haystack = [typeLabel(entry), entry.value, categoryName, ...keywords].join(' ').toLocaleLowerCase();
      return categoryMatch && (!search || haystack.includes(search.toLocaleLowerCase()));
    };

    const entryTile = (
      entry: PresetTypeEntry,
      index: number,
      entries: PresetTypeEntry[],
      command = 'palette.arm.entry',
      entryPreset = presetId(),
      catalog = command !== 'palette.arm.entry',
    ) => {
        const tile = button(command, typeLabel(entry));
        tile.className = 'palette-tile';
        tile.dataset.paletteType = entry.value;
        tile.dataset.paletteEntity = entry.entity ?? 'node';
        tile.dataset.palettePreset = entryPreset;
        tile.dataset.paletteIndex = String(index);
        if (catalog) tile.dataset.paletteCatalog = '';
        if (entry.id) tile.dataset.paletteCustomType = entry.id;
        const preview = document.createElement('span');
        const visual = nodeTypeDefinition(entry.value)?.visual ?? entry.value;
        preview.className = `palette-tile-preview palette-shape-${visual}`;
        if (entry.entity === 'container') preview.classList.add('palette-container-preview');
        preview.dataset.nodeColor = entry.color ?? 'gray';
        preview.dataset.fill = entry.fill ?? 'none';
        preview.dataset.borderColor = entry.border ?? 'automatic';
        if (entry.value === 'operator') preview.textContent = '⊕';
        if (entry.value === 'caption' || entry.value === 'text') preview.textContent = 'T';
        const label = document.createElement('span');
        label.className = 'palette-tile-label';
        label.textContent = typeLabel(entry);
        tile.append(preview, label);
        const node = primaryNode();
        const container = primaryContainer();
        const shownType = node ? node.NodeType : arm.type;
        const shownColor = node ? node.Color : arm.color;
        const shownFill = node ? node.Fill : arm.fill;
        const shownBorder = node ? node.BorderColor : arm.border;
        if (command !== 'palette.arm.entry') {
          pressed(tile, !container && shownType === entry.value);
          return tile;
        }
        const ambiguous = entries.some((candidate, candidateIndex) => candidateIndex !== index && sameVisualEntry(candidate, entry));
        const identityMatches = node ? !ambiguous || node.Label.text === typeLabel(entry) : arm.entryIndex === index;
        pressed(tile, container
          ? entry.entity === 'container' && container.ContainerType === entry.containerType && container.Color === entry.color
          : identityMatches && shownType === entry.value && shownColor === entry.color
            && shownFill === entry.fill && shownBorder === entry.border);
        return tile;
    };

    const catalogItems = (filtered = true) => {
      const items: CatalogItem[] = [];
      BUILTIN_NODE_TYPES.forEach(def => {
        const entry: PresetTypeEntry = { value: def.id, label: def.label };
        if (filtered && !matches(entry, def.category, def.keywords)) return;
        items.push({
          entry, index: -1, preset: 'none', category: def.category,
          keywords: def.keywords ?? [], command: `palette.arm.type.${def.id}`,
        });
      });
      allPresets(io).forEach(preset => typeEntriesFor(io, preset.id).forEach((entry, index) => {
        if (entry.id) return;
        const def = nodeTypeDefinition(entry.value);
        const semantic = entry.entity === 'container' || (!!entry.label && entry.label !== def?.label);
        if (!semantic) return;
        const categoryName = entry.entity === 'container' ? 'Architecture' : def?.category ?? 'Diagram';
        const keywords = [preset.label, ...(def?.keywords ?? [])];
        if (filtered && !matches(entry, categoryName, keywords)) return;
        items.push({ entry, index, preset: preset.id, category: categoryName, keywords, command: 'palette.arm.entry' });
      }));
      const seen = new Set<string>();
      return items.filter(({ entry }) => {
        const key = [typeLabel(entry), entry.value, entry.color, entry.fill, entry.border, entry.entity, entry.containerType].join('|');
        return !seen.has(key) && (seen.add(key), true);
      });
    };

    const refOf = (item: CatalogItem): CatalogRef => ({
      command: item.command, preset: item.preset, index: item.index, type: item.entry.value,
    });
    const catalogTile = (item: CatalogItem) => {
      const ref = refOf(item);
      const key = catalogRefKey(ref);
      const wrap = document.createElement('div');
      wrap.className = 'palette-catalog-tile-wrap';
      wrap.append(entryTile(
        item.entry, item.index, typeEntriesFor(io, item.preset), item.command, item.preset, true,
      ));
      const favorite = button(
        'palette.favorite.toggle',
        `${favorites.some(candidate => catalogRefKey(candidate) === key) ? 'Remove' : 'Add'} ${typeLabel(item.entry)} ${favorites.some(candidate => catalogRefKey(candidate) === key) ? 'from' : 'to'} favorites`,
      );
      setIcon(favorite, favorites.some(candidate => catalogRefKey(candidate) === key) ? 'star-filled' : 'star');
      favorite.className = 'palette-favorite';
      favorite.dataset.paletteFavorite = key;
      favorite.setAttribute('aria-pressed', favorites.some(candidate => catalogRefKey(candidate) === key) ? 'true' : 'false');
      wrap.append(favorite);
      return wrap;
    };

    const reuseBlock = (title: string, refs: CatalogRef[], className: string, empty: string) => {
      const section = block(title);
      section.classList.add(className);
      if (!refs.length) {
        const hint = document.createElement('p');
        hint.className = 'palette-reuse-empty';
        hint.textContent = empty;
        section.append(hint);
        return section;
      }
      const items = new Map(catalogItems(false).map(item => [catalogRefKey(refOf(item)), item]));
      const resolved = refs.flatMap(ref => items.get(catalogRefKey(ref)) ?? []);
      if (!resolved.length) {
        const hint = document.createElement('p');
        hint.className = 'palette-reuse-empty';
        hint.textContent = empty;
        section.append(hint);
        return section;
      }
      const grid = document.createElement('div');
      grid.className = 'palette-types';
      resolved.forEach(item => grid.append(catalogTile(item)));
      section.append(grid);
      return section;
    };

    const catalogBlock = () => {
      const section = document.createElement('section');
      section.classList.add('palette-catalog-block');
      const groups = new Map<string, CatalogItem[]>();
      catalogItems().forEach(item =>
        (groups.get(item.category) ?? groups.set(item.category, []).get(item.category)!).push(item));
      groups.forEach((items, name) => {
        const heading = document.createElement('h4'); heading.textContent = name;
        const grid = document.createElement('div'); grid.className = 'palette-types';
        items.forEach(item => grid.append(catalogTile(item)));
        section.append(heading, grid);
      });
      if (!groups.size) {
        const empty = document.createElement('p'); empty.className = 'palette-catalog-empty'; empty.textContent = 'No node types match.';
        section.append(empty);
      }
      return section;
    };

    const savedTypesBlock = () => {
      const section = block('Saved types');
      section.classList.add('palette-saved-block');
      const grid = document.createElement('div'); grid.className = 'palette-types';
      const savedPresets = [{ id: 'none' as PresetId }, ...allPresets(io)];
      savedPresets.forEach(preset => typeEntriesFor(io, preset.id).forEach((entry, index) => {
        const haystack = `${typeLabel(entry)} ${entry.value}`.toLowerCase();
        if (!entry.id || (search && !haystack.includes(search))) return;
        const entries = typeEntriesFor(io, preset.id);
        const tile = entryTile(entry, index, entries, 'palette.arm.entry', preset.id);
        const wrap = document.createElement('div');
        wrap.className = 'palette-tile-wrap palette-tile-wrap-custom';
        const controls = document.createElement('div');
        controls.className = 'palette-custom-actions';
        const rename = button('palette.custom-type.rename', `Rename ${typeLabel(entry)}`, '✎');
        const remove = button('palette.custom-type.delete.request', `Delete ${typeLabel(entry)}`, '×');
        [rename, remove].forEach(control => {
          control.dataset.customTypeId = entry.id!;
          control.dataset.customTypePreset = preset.id;
          control.dataset.customTypeLabel = typeLabel(entry);
        });
        remove.classList.add('danger');
        controls.append(rename, remove);
        wrap.append(tile, controls);
        grid.append(wrap);
      }));
      const create = button('palette.custom-type.create', 'Create a reusable palette type', '+ New type');
      create.className = 'palette-custom-type';
      if (grid.childElementCount) section.append(grid);
      section.append(create);
      return section;
    };

    const colorBlock = (title: string, kind: 'color' | 'border') => {
      const section = block(title);
      const row = document.createElement('div');
      row.className = 'palette-swatches';
      const node = primaryNode();
      const edge = primaryEdge();
      const container = primaryContainer();
      const current = kind === 'color'
        ? (node ? node.Color : edge ? edge.Color : container ? container.Color : arm.color)
        : (node ? node.BorderColor : arm.border);
      const auto = button(`palette.arm.${kind}.default`, `${title}: automatic`, 'A');
      auto.className = 'palette-swatch palette-swatch-auto';
      pressed(auto, current === undefined);
      row.append(auto);
      if (kind === 'border') {
        const none = button('palette.arm.border.none', 'Border: none', '⊘');
        none.className = 'palette-swatch palette-swatch-none';
        pressed(none, current === 'none');
        row.append(none);
      }
      for (const { value, label } of NODE_COLORS) {
        const swatch = button(`palette.arm.${kind}.${value}`, `${title}: ${label}`);
        swatch.className = `palette-swatch palette-swatch-${SWATCH_CLASS[value]}`;
        pressed(swatch, current === value);
        row.append(swatch);
      }
      section.append(row);
      return section;
    };

    const fillBlock = () => {
      const section = block('Fill');
      const row = document.createElement('div');
      row.className = 'palette-options';
      for (const { value, label } of NODE_FILLS) {
        const option = button(`palette.arm.fill.${value}`, `Fill: ${label}`, value);
        const node = primaryNode();
        pressed(option, (node ? node.Fill : arm.fill) === value);
        row.append(option);
      }
      section.append(row);
      return section;
    };

    const edgeBlock = () => {
      const section = block('Edge style');
      const row = document.createElement('div');
      row.className = 'palette-options palette-edge-kinds';
      const current = primaryEdge()?.EdgeKind;
      for (const { value, label } of EDGE_KINDS) {
        const option = button(`palette.edge.kind.${value}`, `Edge kind: ${label}`, label);
        pressed(option, current === value);
        row.append(option);
      }
      section.append(row);
      return section;
    };

    const drawBody = () => {
      const wrap = document.createElement('div');
      wrap.className = 'palette-draw palette-style-controls';
      const note = document.createElement('p');
      note.textContent = 'Draw · drag canvas to annotate';
      wrap.append(note);
      const color = block('Stroke color');
      const colors = document.createElement('div');
      colors.className = 'palette-swatches';
      for (const { value, label } of NODE_COLORS) {
        const swatch = button(`ink.arm.color.${value}`, `Stroke color: ${label}`);
        swatch.className = `palette-swatch palette-swatch-${SWATCH_CLASS[value]}`;
        pressed(swatch, inkArm.color === value);
        colors.append(swatch);
      }
      color.append(colors);
      const width = block('Width');
      const widths = document.createElement('div');
      widths.className = 'palette-options';
      for (const value of [1.5, 3, 6]) {
        const option = button(`ink.arm.width.${String(value).replace('.', '-')}`, `Stroke width: ${value}`, `${value}`);
        pressed(option, inkArm.width === value);
        widths.append(option);
      }
      width.append(widths);
      const opacity = block('Opacity');
      const opacities = document.createElement('div');
      opacities.className = 'palette-options';
      for (const value of [0.25, 0.5, 0.75, 1]) {
        const option = button(`ink.arm.opacity.${Math.round(value * 100)}`, `Stroke opacity: ${Math.round(value * 100)}%`, `${Math.round(value * 100)}%`);
        pressed(option, inkArm.opacity === value);
        opacities.append(option);
      }
      opacity.append(opacities);
      wrap.append(color, width, opacity);
      return wrap;
    };

    const deleteTypeBody = (entry: PresetTypeEntry) => {
      const root = document.createElement('section');
      root.className = 'properties palette-delete-type';
      const warning = document.createElement('p');
      warning.textContent = `Delete “${typeLabel(entry)}” from this collection? Existing nodes will not change.`;
      const actions = document.createElement('div');
      actions.className = 'form-actions';
      const cancel = button('modal.close', 'Cancel custom type deletion', 'Cancel');
      const confirm = button('palette.custom-type.delete.confirm', `Delete ${typeLabel(entry)}`, 'Delete type');
      confirm.classList.add('danger');
      actions.append(cancel, confirm);
      root.append(warning, actions);
      return root;
    };

    const render = () => {
      const root = document.createElement('div');
      root.className = 'palette-panel';
      root.dataset.mobileOpen = mobileOpen ? 'true' : 'false';
      root.dataset.placing = placing ? 'true' : 'false';
      // The desktop drawer is display:none while folded. Avoid allocating the
      // full searchable catalog on every selection/render cycle until it can
      // actually be seen; fold.changed redraws it when the hamburger opens.
      if (globalThis.innerWidth > 700 && contexts.fold.folded('outline.panel')) return root;
      const toggle = button('palette.mobile.toggle', mobileOpen ? 'Close node palette' : 'Open node palette', mobileOpen ? 'Close' : 'Palette');
      toggle.className = 'palette-mobile-toggle';
      toggle.setAttribute('aria-expanded', mobileOpen ? 'true' : 'false');
      const scrim = button('palette.mobile.close', 'Close node palette');
      scrim.className = 'palette-scrim';
      const sheet = document.createElement('div');
      sheet.className = 'palette-sheet';
      if (globalThis.innerWidth <= 700) {
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Node catalog and drawing styles');
      }
      const close = button('palette.mobile.close', 'Close node palette', '×');
      close.className = 'palette-mobile-close';
      sheet.append(close);
      {
        const catalogOpen = contexts.fold.isOpen('palette.catalog');
        const catalogSection = document.createElement('section');
        catalogSection.className = 'workspace-drawer-section palette-workspace-section';
        const catalogToggle = button('fold.toggle', `${catalogOpen ? 'Collapse' : 'Expand'} node catalog`, `${catalogOpen ? '⌄' : '›'} Node catalog`);
        catalogToggle.className = 'workspace-drawer-section-toggle';
        catalogToggle.dataset.foldId = 'palette.catalog';
        catalogToggle.setAttribute('aria-expanded', catalogOpen ? 'true' : 'false');
        catalogSection.append(catalogToggle);
        if (catalogOpen) {
          catalogSection.append(categoryTabs());
          const catalog = document.createElement('div');
          catalog.className = 'palette-catalog-region';
          catalog.dataset.nativeScroll = '';
          if (category === 'Favorites') {
            catalog.append(reuseBlock('Favorites', favorites, 'palette-favorites-block', 'Star a type to keep it here.'));
          } else {
            if (!search && category === 'All' && recent.length) catalog.append(
              reuseBlock('Recent', recent, 'palette-recent-block', ''),
            );
            catalog.append(catalogBlock());
          }
          catalogSection.append(catalog);
          const saved = savedTypesBlock();
          saved.classList.add('palette-saved-pinned');
          catalogSection.append(saved);
        }
        const styles = document.createElement('div');
        styles.className = 'palette-style-controls';
        styles.append(colorBlock('Color', 'color'), fillBlock(), colorBlock('Border', 'border'));
        if (selectedEdges().length) styles.append(edgeBlock());
        sheet.append(catalogSection);
        if (drawing) sheet.append(drawBody());
        else if (!selection.selectedAll().length) sheet.append(styles);
      }
      root.append(toggle, scrim, sheet);
      return root;
    };

    declarePanel({ id: 'palette', anchor: 'top-left', place: Places.Left, movable: false, layout: 'custom', render, order: 1 });

    on('palette.arm.entry', ({ preset, index }) => {
      const entry = typeEntriesFor(io, preset)[index];
      if (!entry) return;
      remember({ command: 'palette.arm.entry', preset, index, type: entry.value });
      applyEntry(entry, index, preset);
    });
    on('palette.favorite.toggle', ({ key }) => {
      const item = catalogItems(false).find(candidate => catalogRefKey(refOf(candidate)) === key);
      if (!item) return;
      const exists = favorites.some(candidate => catalogRefKey(candidate) === key);
      favorites = exists
        ? favorites.filter(candidate => catalogRefKey(candidate) !== key)
        : [refOf(item), ...favorites].slice(0, 12);
      io.set(FAVORITES_KEY, favorites);
      redraw();
    });
    on('fold.changed', ({ id }) => {
      if (id === 'palette.catalog' || id === 'outline.panel') redraw();
    });
    on('preset.type.changed', ({ preset, entryId, change }) => {
      if (preset !== presetId()) return;
      const entries = typeEntriesFor(io, preset);
      const index = entries.findIndex(entry => entry.id === entryId);
      if (index < 0) return redraw();
      const entry = entries[index];
      if (change === 'created') {
        setArm(entry, index);
        activateArm();
        return;
      }
      if (arm.entryId === entryId) {
        arm = { ...arm, label: typeLabel(entry), entryIndex: index };
        changed();
      } else redraw();
    });
    on('preset.type.deleted', ({ preset, entryId }) => {
      if (preset !== presetId()) return;
      if (arm.entryId === entryId) {
        setPlacement(false);
        reset();
        return;
      }
      if (arm.entryId) {
        const index = typeEntriesFor(io, preset).findIndex(entry => entry.id === arm.entryId);
        if (index >= 0) arm = { ...arm, entryIndex: index };
      }
      redraw();
    });
    on('palette.custom-type.delete.request', ({ preset, entryId }) => {
      const entry = typeEntriesFor(io, preset).find(candidate => candidate.id === entryId);
      if (!entry) return;
      pendingDelete = { preset, entryId };
      emit('modal.open', { title: 'Delete palette type?', visual: 'properties', body: deleteTypeBody(entry) });
    });
    on('palette.custom-type.delete.confirm', () => {
      if (!pendingDelete) return;
      const target = pendingDelete;
      pendingDelete = null;
      emit('preset.type.delete', target);
      emit('modal.close');
    });
    on('palette.arm.type', ({ type }) => {
      const def = nodeTypeDefinition(type);
      if (!def) return;
      remember({ command: `palette.arm.type.${type}`, preset: 'none', index: -1, type });
      applyEntry({ value: def.id, label: def.label }, -1);
    });
    on('palette.arm.color', ({ color }) => {
      if (color !== undefined && !isNodeColor(color)) return;
      arm = { ...arm, color };
      updateSelectedNodes(() => ({ Color: color }));
      updateSelectedEdges({ Color: color });
      updateSelectedContainers({ Color: color });
      changed();
    });
    on('palette.arm.fill', ({ fill }) => {
      if (!isNodeFill(fill)) return;
      arm = { ...arm, fill };
      updateSelectedNodes(() => ({ Fill: fill }));
      changed();
    });
    on('palette.arm.border', ({ border }) => {
      if (border !== undefined && border !== 'none' && !isNodeColor(border)) return;
      arm = { ...arm, border };
      updateSelectedNodes(() => ({ BorderColor: border }));
      changed();
    });
    on('palette.edge.kind', ({ kind }) => {
      if (!isEdgeKind(kind)) return;
      updateSelectedEdges({ EdgeKind: kind });
      redraw();
    });
    on('palette.node.place', ({ point, containerId }) => {
      if (!placing || drawing || erasing) return;
      placeArmed(point, containerId);
    });
    on('palette.place.item', ({ ref, point, client }) => {
      if (!placing || drawing || erasing) return;
      if (ref.kind === 'container') {
        placeArmed(point, deepestContainerAt(client) ?? ref.id);
        return;
      }
      setPlacement(false);
      emit('selection.item.select', ref);
    });
    on('palette.place.activate', () => {
      if (placing) return;
      activateArm();
      placeArmed(contexts.view.spaceCenter(Places.Stage));
    });
    on('palette.place.cancel', () => setPlacement(false));
    on('palette.mobile.toggle', () => setMobileOpen(!mobileOpen));
    on('palette.mobile.close', () => setMobileOpen(false));
    on('palette.mobile.tab', ({ shift }) => {
      const sheet = contexts.places.el(Places.Left)?.querySelector<HTMLElement>('.palette-sheet');
      const focusable = Array.from(sheet?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? (shift ? focusable.length - 1 : 0)
        : (current + (shift ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next]?.focus({ preventScroll: true });
    });
    on('outline.search.changed', ({ query }) => {
      search = query.trimStart();
      if (search) category = 'All';
      redraw();
    });
    on('outline.search.clear', () => { search = ''; redraw(); });
    on('palette.category.set', ({ category: next }) => { category = next; redraw(); });
    on('selection.changed', () => { if (mobileOpen) setMobileOpen(false); redraw(); });
    on('preset.changed', () => { setPlacement(false); reset(); });
    on('graph.switched', () => { setPlacement(false); reset(); });
    on('ink.mode.changed', (state) => {
      drawing = state.drawing;
      if (drawing) {
        setPlacement(false);
        if (globalThis.innerWidth <= 700) setMobileOpen(true);
        else contexts.fold.set('outline.panel', true);
      }
      redraw();
    });
    on('ink.erase.mode.changed', (state) => { erasing = state.erasing; if (erasing) setPlacement(false); redraw(); });
    on('ink.arm.changed', state => { inkArm = state; redraw(); });

    on('graph.node.created', ({ id, styleExplicit }) => {
      if (arm.entity === 'container') return;
      if (styleExplicit) return;
      const node = graphs.current.getNode(id);
      if (!node) return;
      // Older producers (demo loaders/plugins) may emit the fact directly and
      // cannot supply styleExplicit. Treat only store/preset defaults as armable;
      // preserve any concrete type they already authored.
      if (styleExplicit === undefined) {
        const def = getPreset(io, presetId());
        const entry = def?.types.find(candidate => candidate.value === def.defaultNodeType);
        const plain = node.NodeType === 'text' && node.Color === undefined
          && node.Fill === undefined && node.BorderColor === undefined;
        const presetDefault = !!def && node.NodeType === def.defaultNodeType
          && node.Color === entry?.color && node.Fill === entry?.fill
          && node.BorderColor === undefined;
        if (!plain && !presetDefault) return;
      }
      const patch: NodePatch = {
        NodeType: arm.type,
        Color: arm.color,
        Fill: arm.fill,
        BorderColor: arm.border,
      };
      const armPreset = arm.entryPreset ?? presetId();
      const entries = typeEntriesFor(io, armPreset);
      const entry = arm.entryIndex === undefined ? undefined : entries[arm.entryIndex];
      if (entry && (entry.id || armPreset === 'jira'
        || entries.some((candidate, index) => index !== arm.entryIndex && sameVisualEntry(candidate, entry)))) {
        patch.Label = { text: typeLabel(entry) };
      }
      const size = nodeTypeDefinition(arm.type)?.defaultSize;
      if (size && (arm.type === 'operator' || arm.type === 'diamond' || isDefaultNodeSize(node.Size))) patch.Size = size;
      emit('item.update', { ref: nodeRef(id), patch });
      if (mobileOpen) setMobileOpen(false);
    });

    contexts.interaction.cancel.register({
      origin,
      priority: 20,
      background: false,
      blocksPointer: true,
      active: () => placing,
      cancel: () => emit('palette.place.cancel'),
    });
    contexts.interaction.cancel.register({
      origin: `${origin}.mobile`,
      priority: 40,
      background: false,
      active: () => mobileOpen,
      cancel: () => setMobileOpen(false),
    });
    contexts.commands.register([{
      id: 'palette.mobile.tab', label: 'Keep focus in the mobile palette', group: 'palette', hidden: true,
      input: {
        on: 'keydown', key: 'Tab', global: true, prevent: true, stop: true,
        when: event => mobileOpen && globalThis.innerWidth <= 700
          && !!(event.target as Element | null)?.closest('.palette-sheet'),
      },
      payload: ({ event }) => ({ shift: (event as KeyboardEvent).shiftKey }),
    }]);
    contexts.storage.claimDefaults('node', origin);

    contribute({
      origin,
      surface: 'top',
      command: 'palette.place.activate',
      kind: 'button',
      icon: 'node',
      label: 'Add node',
      className: 'canvas-mode-tool palette-place-switch',
      active: () => placing,
      slot: 'start',
      group: 'mode',
      order: 3,
    });

    on('app.start', () => { stageEl()?.classList.toggle('node-placing', placing); redraw(); });
    return () => {
      disposed = true;
      stageEl()?.classList.remove('node-placing');
      placing = false;
      mobileOpen = false;
      search = '';
      category = 'All';
      arm = defaultArm();
    };
  }, { requires: ['graph', 'render.stage'] });
}
