import type { DescriptionPlacement, EdgeKind, NodeColor, NodeFill } from './graph';
import type { EntityDef, PropertyDef } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const svg = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
};

export const property = <T, Patch>(def: PropertyDef<T, Patch>) => def;
export const entityDef = <T, Patch = unknown>(kind: string, def: Omit<EntityDef<T, Patch>, 'kind'>): EntityDef<T, Patch> => ({ kind, ...def });
export const NODE_COLORS: { value: NodeColor; label: string }[] = [
  { value: 'gray', label: 'Gray' },
  { value: 'red', label: 'Red' },
  { value: 'orange', label: 'Orange' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'purple', label: 'Purple' },
  { value: 'pink', label: 'Pink' },
];
export const isNodeColor = (value: unknown): value is NodeColor =>
  NODE_COLORS.some(option => option.value === value);
export const NODE_FILLS: { value: NodeFill; label: string }[] = [
  { value: 'soft', label: 'Soft tint' },
  { value: 'solid', label: 'Solid' },
  { value: 'none', label: 'None' },
];
export const isNodeFill = (value: unknown): value is NodeFill =>
  NODE_FILLS.some(option => option.value === value);
export const EDGE_KINDS: { value: EdgeKind; label: string }[] = [
  { value: 'sync', label: 'Dotted arrow' },
  { value: 'async', label: 'Dashed arrow' },
  { value: 'read', label: 'Subtle arrow' },
  { value: 'write', label: 'Strong arrow' },
  { value: 'plain', label: 'Solid line' },
  { value: 'dashed', label: 'Dashed line' },
  { value: 'residual', label: 'Light arrow' },
];
export const isEdgeKind = (value: unknown): value is EdgeKind =>
  EDGE_KINDS.some(option => option.value === value);
/** Diagram-line kinds render without an arrowhead (plain connector reading). */
export const ARROWLESS_KINDS: readonly EdgeKind[] = ['plain', 'dashed'];
export const DESC_PLACEMENTS: { value: DescriptionPlacement; label: string; icon: string }[] = [
  { value: 'inside', label: 'Inside', icon: 'placement-inside' },
  { value: 'top', label: 'Top', icon: 'placement-top' },
  { value: 'right', label: 'Right', icon: 'placement-right' },
  { value: 'below', label: 'Below', icon: 'placement-below' },
  { value: 'left', label: 'Left', icon: 'placement-left' },
  { value: 'hidden', label: 'Hidden', icon: 'placement-hidden' },
];
export const isDescPlacement = (value: unknown): value is DescriptionPlacement =>
  DESC_PLACEMENTS.some(option => option.value === value);
