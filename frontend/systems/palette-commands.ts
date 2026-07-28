import { clientPoint, itemRefFrom, type AppCtx } from '../core';
import {
  BUILTIN_NODE_TYPES,
  EDGE_KINDS,
  NODE_COLORS,
  NODE_FILLS,
  nodeTypeDefinition,
  nodeTypeLabel,
  type GraphNode,
} from '../model';
import { Places, type CommandSpecInput, type ItemRef } from '../types';
import { customPaletteTypeCommands } from './palette-custom-type-commands';
import type { PaletteArm } from './palette-catalog';
import { CUSTOM_TYPE_FORMS, type PresetId } from './presets';

type PaletteCommandDependencies = {
  activeStyle: () => PaletteArm;
  contexts: AppCtx['contexts'];
  isDrawing: () => boolean;
  isErasing: () => boolean;
  isPlacing: () => boolean;
  presetId: () => PresetId;
  selectedEdges: () => ItemRef[];
  selectedNode: () => GraphNode | undefined;
};

export const paletteCommands = ({
  activeStyle,
  contexts,
  isDrawing,
  isErasing,
  isPlacing,
  presetId,
  selectedEdges,
  selectedNode,
}: PaletteCommandDependencies): CommandSpecInput[] => {
  const typeCommands = BUILTIN_NODE_TYPES.map(def => def.id);
  return [
      {
        id: 'palette.arm.entry', label: 'Arm collection type', event: 'palette.arm.entry',
        group: 'palette', hidden: true,
        payload: ({ target }) => {
          const el = (target as HTMLElement | null)?.closest<HTMLElement>('[data-palette-index]');
          return { preset: el?.dataset.palettePreset ?? '', index: Number(el?.dataset.paletteIndex ?? -1) };
        },
      },
      ...customPaletteTypeCommands({
        activeStyle,
        presetId,
        selectedNode,
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
            if (!isPlacing() || isDrawing() || isErasing()) return false;
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
          when: event => isPlacing() && !isDrawing() && !isErasing()
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
    ];
};

