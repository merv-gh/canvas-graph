import { clientPoint, edgeRef, itemRefFrom, nodeRef, type Registry } from '../core';
import {
  EDGE_KINDS,
  isEdgeKind,
  isNodeColor,
  isNodeFill,
  NODE_COLORS,
  NODE_FILLS,
  BUILTIN_NODE_TYPES,
  isDefaultNodeSize,
  nodeTypeBorder,
  nodeTypeDefinition,
  nodeTypeFill,
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
import { customPaletteTypeCommands } from './palette-custom-type-commands';
import {
  FAVORITES_KEY,
  RECENT_KEY,
  catalogRefKey,
  sameVisualEntry,
  typeLabel,
  type CatalogRef,
  type PaletteArm,
} from './palette-catalog';
import { createPaletteView } from './palette-view';
import {
  activePresetId,
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
    'palette.arm.sync-type': { type: NodeType };
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
      const type = entry?.value ?? 'text';
      return {
        type, color: entry?.color, fill: nodeTypeFill(type, entry?.fill),
        border: nodeTypeBorder(type, entry?.border),
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
        ...arm, type: entry.value, color: entry.color,
        fill: nodeTypeFill(entry.value, entry.fill), border: nodeTypeBorder(entry.value, entry.border),
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
      emit('tool.panel.redraw', { id: 'top' });
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
      ...customPaletteTypeCommands({
        activeStyle: () => arm,
        presetId,
        selectedNode: primaryNode,
        typeForms: CUSTOM_TYPE_FORMS,
      }),
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

    const view = () => createPaletteView({
      contexts,
      io,
      presetId,
      primaryContainer,
      primaryEdge,
      primaryNode,
      selectedEdges,
      state: { arm, category, drawing, favorites, inkArm, mobileOpen, placing, recent, search },
    });

    declarePanel({ id: 'palette', anchor: 'top-left', place: Places.Left, movable: false, layout: 'custom', render: () => view().render(), order: 1 });

    on('palette.arm.entry', ({ preset, index }) => {
      const entry = typeEntriesFor(io, preset)[index];
      if (!entry) return;
      remember({ command: 'palette.arm.entry', preset, index, type: entry.value });
      applyEntry(entry, index, preset);
    });
    on('palette.favorite.toggle', ({ key }) => {
      const paletteView = view();
      const item = paletteView.catalogItems(false)
        .find(candidate => catalogRefKey(paletteView.refOf(candidate)) === key);
      if (!item) return;
      const exists = favorites.some(candidate => catalogRefKey(candidate) === key);
      favorites = exists
        ? favorites.filter(candidate => catalogRefKey(candidate) !== key)
        : [paletteView.refOf(item), ...favorites].slice(0, 12);
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
        contexts.fold.set('palette.catalog', true);
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
      emit('modal.open', { title: 'Delete palette type?', visual: 'properties', body: view().deleteTypeBody(entry) });
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
    on('palette.arm.sync-type', ({ type }) => {
      const def = nodeTypeDefinition(type);
      if (!def) return;
      arm = {
        ...arm,
        type,
        fill: def.defaultFill,
        border: def.defaultBorder,
        entity: 'node',
        containerType: undefined,
        label: def.label,
        entryIndex: undefined,
        entryId: undefined,
        entryPreset: undefined,
      };
      changed();
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
      command: 'palette.arm.type.text',
      kind: 'button',
      icon: 'text',
      label: 'Text tool',
      className: 'canvas-type-tool palette-text-type',
      active: () => arm.type === 'text',
      slot: 'start',
      group: 'type',
      order: 2,
    });

    contribute({
      origin,
      surface: 'top',
      command: 'palette.place.activate',
      kind: 'button',
      icon: () => arm.type === 'text' ? 'text' : 'node',
      label: 'Add node',
      className: 'canvas-mode-tool palette-place-switch',
      active: () => placing,
      slot: 'start',
      group: 'mode',
      order: 3,
    });

    on('app.start', () => {
      stageEl()?.classList.toggle('node-placing', placing);
      const foldState = contexts.fold.all();
      if (!Object.prototype.hasOwnProperty.call(foldState, 'palette.catalog')) {
        contexts.fold.set('palette.catalog', false);
      }
      redraw();
    });
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
