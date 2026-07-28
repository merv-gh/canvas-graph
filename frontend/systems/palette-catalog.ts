import { nodeTypeLabel, type NodeBorder, type NodeColor, type NodeFill, type NodeType } from '../model';
import type { ContainerType } from './container-entity';
import type { PresetId, PresetTypeEntry } from './presets';

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

export type CatalogItem = {
  entry: PresetTypeEntry;
  index: number;
  preset: PresetId;
  category: string;
  keywords: string[];
  command: string;
};

export type CatalogRef = Pick<CatalogItem, 'index' | 'preset' | 'command'> & { type: NodeType };

export const FAVORITES_KEY = 'palette:favorites';
export const RECENT_KEY = 'palette:recent';
export const catalogRefKey = (ref: CatalogRef) =>
  `${ref.command}|${ref.preset}|${ref.index}|${ref.type}`;

export const typeLabel = (entry: PresetTypeEntry) => entry.label ?? nodeTypeLabel(entry.value);
export const sameVisualEntry = (a: PresetTypeEntry, b: PresetTypeEntry) =>
  a.value === b.value && a.color === b.color && a.fill === b.fill && a.border === b.border
  && a.entity === b.entity && a.containerType === b.containerType;

