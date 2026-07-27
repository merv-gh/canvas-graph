import { edgeRef, type Registry } from '../core';
import type { IoApi } from '../core/io';
import { isNodeColor, isNodeFill, isNodeType, NODE_TYPES } from '../model';
import type { EdgeKind, NodeBorder, NodeColor, NodeFill, NodeType } from '../model/graph';
import type { LayoutKind } from './layout';
import type { ContainerType } from './container-entity';

declare module '../types' {
  interface CustomEvents {
    'preset.open': void;
    'preset.set': { preset: PresetId };
    'preset.changed': { preset: PresetId };
    /** Register a user-defined collection at runtime (UGC extension point). */
    'preset.register': { preset: PresetDef };
    'preset.type.register': { preset: PresetId; entry: PresetTypeEntry };
    'preset.type.rename': { preset: PresetId; entryId: string; label: string };
    'preset.type.delete': { preset: PresetId; entryId: string };
    'preset.type.changed': { preset: PresetId; entryId: string; change: 'created' | 'renamed' };
    'preset.type.deleted': { preset: PresetId; entryId: string };
  }
}

/** A collection id is an open string, not a closed union — so user-generated
 *  collections are first-class alongside the built-ins. `'none'` is reserved. */
export type PresetId = string;

/** One entry in a collection's vocabulary: a built-in shape/type plus the
 *  default tint + fill it arms with. Pure JSON — the serialization unit that
 *  makes a whole collection portable and user-authorable. */
export type PresetTypeEntry = {
  /** Stable id exists for locally saved named templates; built-ins need none. */
  id?: string;
  value: NodeType;
  label?: string;
  color?: NodeColor;
  fill?: NodeFill;
  border?: NodeBorder;
  /** Some vocab entries are spatial parents, not decorated nodes. */
  entity?: 'node' | 'container';
  containerType?: ContainerType;
};

/** A collection = a named vocabulary + layout + edge default. Fully
 *  JSON-serializable (every field is a string / number / plain array), so it
 *  round-trips through IO and can be authored, shared, or generated. Adding a
 *  built-in is one object literal below; adding a user one is `registerPreset`
 *  (or `saveUserPreset` to persist it). */
export type PresetDef = {
  id: PresetId;
  label: string;
  layout?: LayoutKind;
  defaultNodeType: NodeType;
  defaultEdgeKind?: EdgeKind;
  types: PresetTypeEntry[];
  /** Built-ins ship in code; user collections are hydrated from IO. */
  builtin?: boolean;
};

export type TypeChoice = { value: NodeType; label: string };

/** Canonical labels for every node type any collection can offer. Palette
 *  commands are generated from the union of these, so keyboard access to a type
 *  never depends on which collection is active. */
export const TYPE_LABELS: Partial<Record<NodeType, string>> = {
  text: 'Text', square: 'Box', circle: 'Circle',
  rounded: 'Rounded', pill: 'Pill', diamond: 'Diamond', parallelogram: 'Parallelogram',
  input: 'Input', embedding: 'Embedding', dense: 'Dense / Linear', attention: 'Attention',
  moe: 'MoE', norm: 'Norm', output: 'Output',
  'uml-class': 'UML class', 'list-item': 'List item', 'section-header': 'Section header',
  milestone: 'Milestone', operator: 'Operator', caption: 'Caption',
};

const t = (value: NodeType, color?: NodeColor, fill?: NodeFill, label?: string): PresetTypeEntry =>
  ({ value, color, fill, label });
const container = (label: string, containerType: ContainerType, color: NodeColor): PresetTypeEntry =>
  ({ value: 'square', label, color, fill: 'soft', entity: 'container', containerType });

/** Built-in collections. Each is plain data; the same shape a user collection
 *  takes. New collections that only recombine existing shapes + colors need no
 *  CSS — node styling is data-driven (`data-fill` / `data-node-color`). */
const BUILTINS: PresetDef[] = [
  { id: 'basic', label: 'Basic', defaultNodeType: 'text', builtin: true, types: [
    t('square', 'gray', 'soft'), t('rounded', 'gray', 'soft'), t('circle', 'gray', 'soft'),
    t('diamond', 'gray', 'soft'), t('text'), t('operator', 'gray') ] },
  { id: 'architecture', label: 'Architecture', layout: 'vertical', defaultNodeType: 'dense',
    defaultEdgeKind: 'plain', builtin: true, types: [
    t('input', 'gray', 'soft'), t('embedding', 'purple', 'soft'), t('dense', 'blue', 'soft'),
    t('attention', 'red', 'soft'), t('moe', 'orange', 'soft'), t('norm', 'green', 'soft'),
    t('output', 'gray', 'soft'), t('operator', 'gray'), t('caption') ] },
  { id: 'jira', label: 'Jira', layout: 'tree', defaultNodeType: 'square', builtin: true, types: [
    t('circle', 'gray', 'soft', 'Start'), t('square', 'gray', 'solid', 'Open'),
    t('square', 'yellow', 'solid', 'In progress'), t('square', 'green', 'solid', 'Resolved'),
    t('square', 'green', 'solid', 'Closed'), t('square', 'gray', 'solid', 'Reopened') ] },
  { id: 'flowchart', label: 'Flowchart', layout: 'vertical', defaultNodeType: 'square', builtin: true, types: [
    t('pill', 'green', 'soft', 'Start / End'), t('square', 'blue', 'soft', 'Process'),
    t('diamond', 'yellow', 'soft', 'Decision'), t('parallelogram', 'purple', 'soft', 'Input / Output'),
    t('rounded', 'green', 'soft', 'Prepare'), t('operator', 'gray', undefined, 'Connector') ] },
  { id: 'mindmap', label: 'Mindmap', layout: 'radial', defaultNodeType: 'rounded', builtin: true, types: [
    t('rounded', 'gray', 'solid', 'Central'), t('pill', 'blue', 'solid', 'Branch'),
    t('pill', 'green', 'solid', 'Branch'), t('pill', 'orange', 'solid', 'Branch'),
    t('pill', 'purple', 'solid', 'Branch'), t('text', undefined, undefined, 'Leaf') ] },
  { id: 'c4', label: 'C4', layout: 'vertical', defaultNodeType: 'rounded', builtin: true, types: [
    t('rounded', 'gray', 'solid', 'Person'), container('System', 'c4-system', 'blue'),
    container('Container', 'c4-container', 'purple'), t('square', 'green', 'soft', 'Component'),
    t('square', 'gray', 'soft', 'External'), t('pill', 'blue', 'soft', 'Datastore') ] },
  { id: 'uml', label: 'UML', layout: 'tree', defaultNodeType: 'uml-class', builtin: true, types: [
    t('uml-class'), t('text'), t('square'), t('circle') ] },
  { id: 'outline', label: 'Outline', layout: 'vertical', defaultNodeType: 'list-item', builtin: true, types: [
    t('list-item'), t('section-header'), t('milestone'), t('text') ] },
  { id: 'autonomous', label: 'Autonomous systems', layout: 'horizontal', defaultNodeType: 'timeline-step',
    defaultEdgeKind: 'plain', builtin: true, types: [
    t('agent', 'blue', 'soft'), t('timeline-step', 'gray', 'soft'), t('data-table', 'purple', 'soft'),
    t('toggle', 'green', 'soft'), t('artifact', 'orange', 'soft'), t('approval-gate', 'yellow', 'soft') ] },
];

/** Forms users can safely compose without adding renderer-specific semantics. */
export const CUSTOM_TYPE_FORMS: { value: NodeType; label: string }[] = NODE_TYPES;
const CUSTOM_FORM_VALUES = new Set<NodeType>(CUSTOM_TYPE_FORMS.map(option => option.value));

/** Order used by the command-search collection picker. The persistent node
 * gallery is universal and intentionally has no collection switcher. */
const CHOICE_ORDER = ['basic', 'architecture', 'jira', 'flowchart', 'mindmap', 'c4', 'uml', 'outline', 'autonomous'];

/** Validate an untrusted collection (e.g. loaded from IO / pasted JSON) before
 *  it enters the registry. Drops entries with unknown shapes; keeps the rest. */
export function sanitizePreset(input: unknown): PresetDef | null {
  const def = input as Partial<PresetDef>;
  if (!def || typeof def.id !== 'string' || !def.id || def.id === 'none') return null;
  if (typeof def.label !== 'string' || !def.label) return null;
  const types = Array.isArray(def.types) ? def.types.filter((e): e is PresetTypeEntry =>
    !!e && typeof (e as PresetTypeEntry).value === 'string'
    && isNodeType(e.value)
    && (e.color === undefined || isNodeColor(e.color))
    && (e.fill === undefined || isNodeFill(e.fill))
    && (e.border === undefined || e.border === 'none' || isNodeColor(e.border))
    && (e.entity === undefined || e.entity === 'node' || e.entity === 'container')
    && (e.containerType === undefined || e.containerType === 'group' || e.containerType === 'c4-system' || e.containerType === 'c4-container')) : [];
  if (!types.length || typeof def.defaultNodeType !== 'string') return null;
  return {
    id: def.id, label: def.label, layout: def.layout, defaultNodeType: def.defaultNodeType,
    defaultEdgeKind: def.defaultEdgeKind, types, builtin: false,
  };
}

const userPresets = (io: IoApi): PresetDef[] => io.get<unknown[]>('presets:user', [])
  .map(sanitizePreset).filter((def): def is PresetDef => !!def);

export const allPresets = (io: IoApi): PresetDef[] => {
  const byId = new Map(BUILTINS.map(def => [def.id, def]));
  userPresets(io).forEach(def => byId.set(def.id, def));
  return [...byId.values()];
};
export const getPreset = (io: IoApi, id: PresetId): PresetDef | undefined =>
  allPresets(io).find(def => def.id === id);
export const hasPreset = (io: IoApi, id: unknown): id is PresetId =>
  typeof id === 'string' && !!getPreset(io, id);

export const presetChoices = (io: IoApi): { id: PresetId; label: string }[] => {
  const registry = new Map(allPresets(io).map(def => [def.id, def]));
  const seen = new Set<string>();
  const ordered: PresetDef[] = [];
  for (const id of CHOICE_ORDER) { const d = registry.get(id); if (d) { ordered.push(d); seen.add(id); } }
  for (const d of registry.values()) if (!seen.has(d.id)) ordered.push(d);
  return [{ id: 'none', label: 'None' }, ...ordered.map(d => ({ id: d.id, label: d.label }))];
};

const customTypesFor = (io: IoApi, preset: PresetId): PresetTypeEntry[] =>
  io.get<unknown[]>(CUSTOM_TYPE_KEY, []).flatMap(value => {
    const item = value as Partial<SavedCustomType>;
    if (item.preset !== preset) return [];
    const entry = sanitizeCustomType(item.entry);
    return entry ? [entry] : [];
  });

export const typeEntriesFor = (io: IoApi, id: PresetId): PresetTypeEntry[] => {
  const def = getPreset(io, id);
  if (def) return [...def.types, ...customTypesFor(io, id)];
  // `none` → the base vocabulary: generic shapes + ML blocks.
  return [t('text'), t('square'), t('circle'), t('rounded'), t('diamond'),
    t('input'), t('embedding'), t('dense'), t('attention'), t('moe'), t('norm'), t('output'),
    ...customTypesFor(io, id)];
};

/** Legacy type picker (modal) keys by NodeType, so collapse entries that reuse
 *  the same shape (e.g. Jira's four coloured boxes). The entry-based palette
 *  uses the full `typeEntriesFor` and keeps every distinct arm. */
export const typeChoicesFor = (io: IoApi, id: PresetId): TypeChoice[] => {
  const seen = new Set<NodeType>();
  return typeEntriesFor(io, id)
    .filter(e => !seen.has(e.value) && (seen.add(e.value), true))
    .map(e => ({ value: e.value, label: TYPE_LABELS[e.value] ?? e.value }));
};

// -------- persistence: active collection per graph + user collections --------

const keyFor = (graphId: string) => `preset:${graphId}`;
const USER_KEY = 'presets:user';
const CUSTOM_TYPE_KEY = 'presets:types:user';

type SavedCustomType = { preset: PresetId; entry: PresetTypeEntry };

const sanitizeCustomType = (input: unknown): PresetTypeEntry | null => {
  const entry = input as Partial<PresetTypeEntry>;
  if (!entry || typeof entry.id !== 'string' || !entry.id) return null;
  if (typeof entry.label !== 'string' || !entry.label.trim()) return null;
  if (!CUSTOM_FORM_VALUES.has(entry.value as NodeType)) return null;
  if (entry.color !== undefined && !isNodeColor(entry.color)) return null;
  if (entry.fill !== undefined && !isNodeFill(entry.fill)) return null;
  if (entry.border !== undefined && entry.border !== 'none' && !isNodeColor(entry.border)) return null;
  return {
    id: entry.id,
    label: entry.label.trim().slice(0, 48),
    value: entry.value as NodeType,
    color: entry.color,
    fill: entry.fill,
    border: entry.border,
  };
};

const validateCustomType = (io: IoApi, preset: PresetId, input: unknown): PresetTypeEntry | null => {
  if (preset !== 'none' && !hasPreset(io, preset)) return null;
  const entry = sanitizeCustomType(input);
  return entry;
};

export function saveCustomPresetType(io: IoApi, preset: PresetId, input: PresetTypeEntry): PresetTypeEntry | null {
  const entry = validateCustomType(io, preset, input);
  if (!entry) return null;
  const saved = io.get<SavedCustomType[]>(CUSTOM_TYPE_KEY, []);
  const index = saved.findIndex(item => item.preset === preset && item.entry.id === entry.id);
  const next = [...saved];
  if (index < 0) next.push({ preset, entry }); else next[index] = { preset, entry };
  io.set(CUSTOM_TYPE_KEY, next);
  return entry;
}

export function renameCustomPresetType(io: IoApi, preset: PresetId, entryId: string, label: string): PresetTypeEntry | null {
  const entry = customTypesFor(io, preset).find(candidate => candidate.id === entryId);
  return entry ? saveCustomPresetType(io, preset, { ...entry, label }) : null;
}

export function deleteCustomPresetType(io: IoApi, preset: PresetId, entryId: string): boolean {
  const current = customTypesFor(io, preset);
  if (!current.some(entry => entry.id === entryId)) return false;
  io.set(CUSTOM_TYPE_KEY, io.get<SavedCustomType[]>(CUSTOM_TYPE_KEY, [])
    .filter(item => !(item.preset === preset && item.entry.id === entryId)));
  return true;
}

/** The active collection for a graph. */
export const activePresetId = (io: IoApi, graphId: string): PresetId => {
  const stored = io.get<PresetId>(keyFor(graphId), 'none');
  return stored === 'none' || hasPreset(io, stored) ? stored : 'none';
};

/** Persist a user collection (and register it live). */
export function saveUserPreset(io: IoApi, def: PresetDef): void {
  const clean = sanitizePreset(def);
  if (!clean) return;
  const saved = io.get<PresetDef[]>(USER_KEY, []).filter(d => d.id !== clean.id);
  io.set(USER_KEY, [...saved, clean]);
}

/** Preset switch. Persisted per graph; applied as `data-preset` on `.shell` so
 *  any collection CSS cascades without touching node data. New nodes/edges
 *  created while a collection is active adopt its defaults (type + tint + fill
 *  + edge kind) unless the caller set them explicitly. */
export function registerPresets(system: Registry) {
  system('presets', ({ io, contexts, graphs, on, emit }) => {
    const shellEl = () => contexts.places.el('top')?.parentElement as HTMLElement | null;
    const currentPreset = (): PresetId => activePresetId(io, graphs.current.id);

    const applyPreset = () => {
      const shell = shellEl();
      if (!shell) return;
      const preset = currentPreset();
      if (preset === 'none') shell.removeAttribute('data-preset');
      else shell.setAttribute('data-preset', preset);
    };

    const presetBody = () => {
      const active = currentPreset();
      const panel = document.createElement('section');
      panel.className = 'preset-picker';
      const intro = document.createElement('p');
      intro.textContent = 'Collections swap the node vocabulary and defaults for new nodes. Existing nodes and the current layout stay in place.';
      const choices = document.createElement('div');
      choices.className = 'preset-choices';
      for (const choice of presetChoices(io)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.command = 'preset.set';
        button.dataset.presetChoice = choice.id;
        button.textContent = choice.label;
        button.setAttribute('aria-pressed', choice.id === active ? 'true' : 'false');
        if (choice.id === active) button.classList.add('active');
        choices.append(button);
      }
      panel.append(intro, choices);
      return panel;
    };

    contexts.commands.register([
      { id: 'preset.open', label: 'Choose collection', group: 'layout' },
      {
        id: 'preset.set',
        label: 'Apply collection',
        group: 'layout',
        hidden: true,
        input: { on: 'click', selector: '[data-preset-choice]' },
        payload: ({ target }): { preset: PresetId } => {
          const choice = ((target as HTMLElement | null)?.closest('[data-preset-choice]') as HTMLElement | null)?.dataset.presetChoice;
          return { preset: hasPreset(io, choice) ? choice : 'none' };
        },
      },
    ]);

    on('preset.register', ({ preset }) => { saveUserPreset(io, preset); });
    on('preset.type.register', ({ preset, entry }) => {
      const saved = saveCustomPresetType(io, preset, entry);
      if (!saved?.id) {
        emit('app.notice', { message: 'Could not save that palette type.', level: 'warn' });
        return;
      }
      emit('preset.type.changed', { preset, entryId: saved.id, change: 'created' });
      emit('app.notice', { message: `Saved “${saved.label}” to this collection.` });
    });
    on('preset.type.rename', ({ preset, entryId, label }) => {
      const saved = renameCustomPresetType(io, preset, entryId, label);
      if (!saved?.id) {
        emit('app.notice', { message: 'Could not rename that palette type.', level: 'warn' });
        return;
      }
      emit('preset.type.changed', { preset, entryId, change: 'renamed' });
      emit('app.notice', { message: `Renamed palette type to “${saved.label}”.` });
    });
    on('preset.type.delete', ({ preset, entryId }) => {
      if (!deleteCustomPresetType(io, preset, entryId)) return;
      emit('preset.type.deleted', { preset, entryId });
      emit('app.notice', { message: 'Palette type deleted.' });
    });

    on('preset.open', () => {
      emit('modal.open', { title: 'Choose collection', visual: 'properties', body: presetBody });
    });

    on('preset.set', ({ preset }) => {
      const next: PresetId = hasPreset(io, preset) ? preset : 'none';
      io.set(keyFor(graphs.current.id), next);
      applyPreset();
      emit('preset.changed', { preset: next });
      emit('modal.close');
    });

    // Same contract for edges: only edges created without an explicit kind
    // adopt the collection's default.
    on('graph.edge.created', ({ id, edge }) => {
      const kind = getPreset(io, currentPreset())?.defaultEdgeKind;
      if (!kind || edge.EdgeKind) return;
      emit('item.update', { ref: edgeRef(id), patch: { EdgeKind: kind } });
    });

    on('app.start', () => { queueMicrotask(applyPreset); });
    on('graph.switched', () => applyPreset());

  }, { requires: ['render', 'graph'] });
}
