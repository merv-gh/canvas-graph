import { edgeRef, itemRefFrom, nodeRef, type Registry } from '../core';
import {
  isDefaultNodeSize, isEdgeKind, isNodeColor, isNodeFill,
  nodeTypeBorder, nodeTypeDefinition, nodeTypeFill,
  type EdgePatch, type NodeColor, type NodePatch,
} from '../model';
import { Places, type ItemRef } from '../types';
import type { ContainerType } from './container-entity';
import { paletteCommands } from './palette-commands';
import { registerPaletteSurface } from './palette-surface';
import './palette-events';
import {
  FAVORITES_KEY, RECENT_KEY, catalogRefKey, sameVisualEntry, typeLabel,
  type CatalogRef, type PaletteArm,
} from './palette-catalog';
import { createPaletteView } from './palette-view';
import { activePresetId, getPreset, typeEntriesFor, type PresetId, type PresetTypeEntry } from './presets';

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

    contexts.commands.register(paletteCommands({
      activeStyle: () => arm,
      contexts,
      isDrawing: () => drawing,
      isErasing: () => erasing,
      isPlacing: () => placing,
      presetId,
      selectedEdges,
      selectedNode: primaryNode,
    }));

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

    registerPaletteSurface({
      contribute,
      contexts,
      emit,
      isMobileOpen: () => mobileOpen,
      isPlacing: () => placing,
      isText: () => arm.type === 'text',
      origin,
      setMobileOpen,
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
