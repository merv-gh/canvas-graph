import type { NodeTypeDef } from '../types';
import type { NodeType } from './graph';

const define = <T extends NodeTypeDef[]>(defs: T): T => defs;

/** Canonical searchable vocabulary. Domain additions normally require one row
 * here. Reuse an existing `visual`; only new rendering grammar needs CSS/DOM. */
export const BUILTIN_NODE_TYPES = define([
  { id: 'text', label: 'Text', category: 'Basics', keywords: ['note', 'label'], visual: 'card', defaultSize: { w: 170, h: 76 } },
  { id: 'square', label: 'Box', category: 'Basics', keywords: ['rectangle', 'card'], visual: 'card' },
  { id: 'rounded', label: 'Rounded box', category: 'Basics', keywords: ['card'], visual: 'rounded' },
  { id: 'pill', label: 'Pill', category: 'Basics', keywords: ['start', 'end', 'status'], visual: 'pill' },
  { id: 'circle', label: 'Circle', category: 'Basics', keywords: ['state', 'start'], visual: 'circle', defaultSize: { w: 112, h: 112 } },
  { id: 'diamond', label: 'Diamond', category: 'Basics', keywords: ['decision', 'gate'], visual: 'diamond', defaultSize: { w: 112, h: 112 } },
  { id: 'parallelogram', label: 'Parallelogram', category: 'Basics', keywords: ['input', 'output'], visual: 'parallelogram', defaultSize: { w: 150, h: 80 } },
  { id: 'service', label: 'Service', category: 'Architecture', keywords: ['api', 'component'], visual: 'rounded' },
  { id: 'database', label: 'Database', category: 'Architecture', keywords: ['storage', 'data'], visual: 'card' },
  { id: 'kafka', label: 'Kafka', category: 'Architecture', keywords: ['queue', 'event', 'stream'], visual: 'card' },
  { id: 'index', label: 'Index', category: 'Architecture', keywords: ['search'], visual: 'card' },
  { id: 'user-input', label: 'User input', category: 'Architecture', keywords: ['actor', 'request'], visual: 'parallelogram' },
  { id: 'gateway', label: 'Gateway', category: 'Architecture', keywords: ['proxy', 'edge'], visual: 'diamond' },
  { id: 'cache', label: 'Cache', category: 'Architecture', keywords: ['memory'], visual: 'card' },
  { id: 'rate-limit', label: 'Rate limiter', category: 'Architecture', keywords: ['throttle'], visual: 'card' },
  { id: 'circuit-breaker', label: 'Circuit breaker', category: 'Architecture', keywords: ['resilience', 'failure'], visual: 'card' },
  { id: 'input', label: 'ML · Input', category: 'Data & AI', keywords: ['tokens', 'features'], visual: 'parallelogram' },
  { id: 'embedding', label: 'ML · Embedding', category: 'Data & AI', keywords: ['vector'], visual: 'card' },
  { id: 'dense', label: 'ML · Dense / Linear', category: 'Data & AI', keywords: ['layer'], visual: 'card' },
  { id: 'attention', label: 'ML · Attention', category: 'Data & AI', keywords: ['transformer'], visual: 'card' },
  { id: 'moe', label: 'ML · MoE', category: 'Data & AI', keywords: ['experts', 'router'], visual: 'card' },
  { id: 'norm', label: 'ML · Norm', category: 'Data & AI', keywords: ['normalize'], visual: 'pill' },
  { id: 'output', label: 'ML · Output', category: 'Data & AI', keywords: ['result'], visual: 'parallelogram' },
  { id: 'operator', label: 'Operator', category: 'Diagram', keywords: ['merge', 'sum', 'connector'], visual: 'operator', defaultSize: { w: 44, h: 44 } },
  { id: 'caption', label: 'Caption', category: 'Diagram', keywords: ['annotation', 'legend'], visual: 'caption' },
  { id: 'uml-class', label: 'UML class', category: 'Diagram', keywords: ['model', 'members'], visual: 'table', defaultSize: { w: 260, h: 170 } },
  { id: 'milestone', label: 'Milestone', category: 'Planning', keywords: ['date', 'release'], visual: 'timeline' },
  { id: 'list-item', label: 'List item', category: 'Planning', keywords: ['task', 'outline'], visual: 'list' },
  { id: 'section-header', label: 'Section header', category: 'Planning', keywords: ['heading', 'outline'], visual: 'section' },
  { id: 'agent', label: 'Agent', category: 'Autonomous systems', keywords: ['sub-agent', 'worker', 'role'], visual: 'agent', defaultSize: { w: 210, h: 96 }, autoSize: false },
  { id: 'timeline-step', label: 'Timeline step', category: 'Autonomous systems', keywords: ['lane', 'task', 'duration'], visual: 'timeline', defaultSize: { w: 240, h: 88 }, autoSize: false },
  { id: 'data-table', label: 'Data table', category: 'Autonomous systems', keywords: ['report', 'rows', 'metrics'], visual: 'table', defaultSize: { w: 300, h: 190 }, autoSize: false },
  { id: 'toggle', label: 'Button switch', category: 'Autonomous systems', keywords: ['control', 'flag', 'on', 'off'], visual: 'switch', defaultSize: { w: 210, h: 84 }, autoSize: false },
  { id: 'artifact', label: 'Artifact', category: 'Autonomous systems', keywords: ['markdown', 'file', 'output', 'handoff'], visual: 'artifact', defaultSize: { w: 230, h: 100 }, autoSize: false },
  { id: 'approval-gate', label: 'Approval gate', category: 'Autonomous systems', keywords: ['human', 'blocked', 'decision'], visual: 'approval', defaultSize: { w: 180, h: 118 }, autoSize: false },
] satisfies NodeTypeDef[]);

export const NODE_TYPES: { value: NodeType; label: string }[] =
  BUILTIN_NODE_TYPES.map(({ id, label }) => ({ value: id, label }));

export const NODE_TYPE_CATEGORIES = [...new Set(BUILTIN_NODE_TYPES.map(def => def.category))];
export const nodeTypeDefinition = (id: unknown): NodeTypeDef | undefined =>
  typeof id === 'string' ? BUILTIN_NODE_TYPES.find(def => def.id === id) : undefined;
export const isNodeType = (value: unknown): value is NodeType => !!nodeTypeDefinition(value);
export const nodeTypeLabel = (id: string) => nodeTypeDefinition(id)?.label ?? id;
export const isDefaultNodeSize = (size: { w: number; h: number }) =>
  (size.w === 150 && size.h === 64)
  || BUILTIN_NODE_TYPES.some(def => def.defaultSize?.w === size.w && def.defaultSize?.h === size.h);
