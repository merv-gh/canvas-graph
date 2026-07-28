import type { NodeBorder, NodeColor, NodeFill, NodeType, EdgeKind } from '../model';
import type { ItemRef } from '../types';
import type { ContainerType } from './container-entity';
import type { PresetId } from './presets';

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

