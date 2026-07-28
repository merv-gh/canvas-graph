import type { DataScale, SemanticFields } from '../core/semantics';
import type { Id, Label, Position, Size } from '../types';

export type { DataScale, SemanticFields } from '../core/semantics';

// ----- Domain types -----
// Live here, next to the classes implementing them. Anything kind-specific
// (node, edge, future container) belongs in the model layer, not in types.ts.
export type Entity = { id: Id; kind: string; Label: Label; Size: Size; Position?: Position };

export type SystemNodeType = 'database' | 'kafka' | 'service' | 'index' | 'user-input' | 'gateway' | 'cache' | 'rate-limit' | 'circuit-breaker';
export type PresetNodeType = 'milestone' | 'uml-class' | 'list-item' | 'section-header';
export type MlNodeType = 'input' | 'embedding' | 'dense' | 'attention' | 'moe' | 'norm' | 'output';
/** Diagram furniture: `operator` is a small circle whose glyph is the Label
 *  ("⊕", "α", "w"); `caption` is a borderless muted text card. */
export type DiagramNodeType = 'operator' | 'caption';
/** Pure geometry shapes — no domain meaning, just a form. `diamond` and
 *  `parallelogram` are flowchart primitives; `pill`/`rounded` round the box. */
export type ShapeNodeType = 'rounded' | 'pill' | 'diamond' | 'parallelogram';
/** Open catalog id. Validation and labels come from the model's node-type
 * registry, allowing plugins to add vocabulary without widening this file. */
export type NodeType = string;
/** Where a node renders its Description relative to the card. Default
 *  (undefined) is `inside` — today's rendering. */
export type DescriptionPlacement = 'inside' | 'top' | 'right' | 'below' | 'left' | 'hidden';
/** User-chosen tint for a node, applied as `--node-tone` via `data-node-color`.
 *  Palette keys, not hex — the CSS owns the actual values so themes stay coherent. */
export type NodeColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'gray';
/** Fill treatment, applied data-driven (no per-type CSS): `soft` is a tinted
 *  wash (today's default look), `solid` a filled block, `none` transparent. */
export type NodeFill = 'none' | 'soft' | 'solid';
/** Border tint independent of the node's primary Color; `none` hides it. */
export type NodeBorder = NodeColor | 'none';
export type EdgeKind = 'read' | 'write' | 'sync' | 'async' | 'plain' | 'dashed' | 'residual';
export type NodeEntity = Entity & SemanticFields & {
  kind: 'node';
  NodeType: NodeType;
  Color?: NodeColor;
  Fill?: NodeFill;
  BorderColor?: NodeBorder;
  ToggleState?: boolean;
  Description?: string;
  DescriptionPlacement?: DescriptionPlacement;
  ComputeMs?: number;
  ExpectedRps?: number;
  LatencyMs?: number;
};
export type NodeDraft = {
  Label?: Label;
  Position?: Position;
  Size?: Size;
  NodeType?: NodeType;
  Fill?: NodeFill;
  BorderColor?: NodeBorder;
  ToggleState?: boolean;
  Color?: NodeColor;
  Description?: string;
  DescriptionPlacement?: DescriptionPlacement;
  ComputeMs?: number;
  ExpectedRps?: number;
  LatencyMs?: number;
} & SemanticFields;
export type NodePatch = Partial<Pick<NodeEntity, 'Label' | 'Size' | 'Position' | 'NodeType' | 'Color' | 'Fill' | 'BorderColor' | 'ToggleState' | 'Description' | 'DescriptionPlacement' | 'ComputeMs' | 'ExpectedRps' | 'LatencyMs' | 'Purpose' | 'Assumptions' | 'Limits' | 'WhatThen' | 'Observability' | 'FailureMode' | 'DataScale' | 'FreshnessMs'>>;
export type NodeCreateOptions = { at?: Position; near?: Id | null };

/** Operation-time hints attached to create events. They control the lifecycle around the
 *  new node — focus behavior, edge creation, placement anchor — without polluting NodeDraft. */
export type CreateHints = {
  /** Don't move focus to the new node. Selection still moves (so user can keep editing). */
  keepFocus?: boolean;
  /** Place the new node near this id, using the same near-placement heuristic as the graph store. */
  relativeTo?: Id;
  /** After the node lands, also create an edge from this id to the new node id. */
  connectFrom?: Id;
  /** Edge kind for the optional created edge. */
  connectKind?: EdgeKind;
  /** Preserve the current camera after direct pointer placement/creation. */
  keepView?: boolean;
};

export type EdgeEntity = SemanticFields & {
  id: Id;
  kind: 'edge';
  From: Id;
  To: Id;
  Label?: Label;
  EdgeKind?: EdgeKind;
  Color?: NodeColor;
  LatencyMs?: number;
  ThroughputRps?: number;
  PayloadKb?: number;
};
export type EdgeDraft = { From: Id; To: Id; Label?: Label; EdgeKind?: EdgeKind; Color?: NodeColor; LatencyMs?: number; ThroughputRps?: number; PayloadKb?: number } & SemanticFields;
export type EdgeCreateDraft = Partial<EdgeDraft>;
export type EdgePatch = Partial<Pick<EdgeEntity, 'Label' | 'From' | 'To' | 'EdgeKind' | 'Color' | 'LatencyMs' | 'ThroughputRps' | 'PayloadKb' | 'Purpose' | 'Assumptions' | 'Limits' | 'WhatThen' | 'Observability' | 'FailureMode' | 'DataScale' | 'FreshnessMs'>>;
export type GraphSnapshot = {
  /** Versioned document envelope. Missing means legacy v0 (nodes + edges only). */
  schemaVersion?: 1;
  name?: string;
  nodes: NodeDraftWithId[];
  edges: EdgeDraftWithId[];
  /** Entity-owned data. Core preserves unknown keys for forward compatibility. */
  extensions?: Record<string, unknown>;
};
export type NodeDraftWithId = NodeDraft & { id: Id };
export type EdgeDraftWithId = EdgeDraft & { id: Id };

