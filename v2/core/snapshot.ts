import type { AppCtx } from '../core';

/** One node in the inspectable state tree. `code` is the TypeScript expression
 *  a test would use to read this value from a booted `ctx` — clicking a leaf
 *  in the assert modal generates an assertion against this expression. */
export type SnapshotNode = {
  /** Human label for the tree row (object key, array index, etc.). */
  label: string;
  /** TS expression that returns this value from a `ctx: AppCtx`. */
  code: string;
  value: unknown;
  kind: 'literal' | 'object' | 'array';
  children?: SnapshotNode[];
};

/** Capture the user-visible structural state. The shape is intentionally a
 *  POJO so it round-trips through JSON for downloading / diffing / snapshot
 *  testing, and so the tree builder doesn't have to special-case live objects.
 *
 *  Each root key gets a tailored `code` mapping (see `ROOT_CODE`) so a click
 *  on a leaf generates a readable assertion — `ctx.graphs.current.nodes()`,
 *  not `ctx.snapshot().graph.nodes`. */
export function snapshot(ctx: AppCtx) {
  const graph = ctx.graphs.current;
  const containers = graph.itemsOfKind('container') as Array<{
    id: string; Label?: { text: string }; Collapsed?: boolean; Position?: unknown; Size?: unknown; Children?: unknown;
  }>;
  const dxIssues = ctx.contexts.dx.run();
  return {
    graph: {
      id: graph.id,
      nodes: graph.nodes().map(n => ({
        id: n.id,
        Label: n.Label,
        Position: n.Position,
        Size: n.Size,
        Collapsed: !!n.Collapsed,
      })),
      edges: graph.edges().map(e => ({
        id: e.id,
        From: e.From,
        To: e.To,
        Label: e.Label,
      })),
      containers: containers.map(c => ({
        id: c.id,
        Label: c.Label,
        Collapsed: !!c.Collapsed,
        Position: c.Position,
        Size: c.Size,
        Children: c.Children,
      })),
    },
    selection: {
      selected: ctx.selection.selected(),
      focused: ctx.selection.focused(),
    },
    view: ctx.contexts.view.get(),
    flags: {
      system: ctx.flags.declared('system').filter(n => ctx.flags.isOn(n)),
      ability: ctx.flags.declared('ability').filter(n => ctx.flags.isOn(n)),
      feature: ctx.flags.declared('feature').filter(n => ctx.flags.isOn(n)),
    },
    fold: ctx.contexts.fold.all(),
    dx: {
      errors: dxIssues.filter(i => i.level === 'error').length,
      warnings: dxIssues.filter(i => i.level === 'warn').length,
    },
  };
}

export type Snapshot = ReturnType<typeof snapshot>;

/** Hand-tuned root-key → TS expression map. Anything not listed falls back to
 *  property access on `snapshot.<key>` which still works at runtime but reads
 *  less naturally in tests. */
const ROOT_CODE: Record<string, string> = {
  graph: 'ctx.graphs.current',
  selection: 'ctx.selection',
  view: 'ctx.contexts.view.get()',
  flags: 'ctx.flags',
  fold: 'ctx.contexts.fold.all()',
  dx: 'ctx.contexts.dx.run()',
};

/** Selection has method-shaped readers (`selected()`, `focused()`) instead of
 *  plain properties. Map those too so generated tests look idiomatic. */
const SELECTION_CODE: Record<string, string> = {
  selected: 'ctx.selection.selected()',
  focused: 'ctx.selection.focused()',
};

/** Graph readers — same treatment. nodes/edges are methods; container kind
 *  lives behind `itemsOfKind`. */
const GRAPH_CODE: Record<string, string> = {
  id: 'ctx.graphs.current.id',
  nodes: 'ctx.graphs.current.nodes()',
  edges: 'ctx.graphs.current.edges()',
  containers: "ctx.graphs.current.itemsOfKind('container')",
};

const FLAGS_CODE: Record<string, string> = {
  system: "ctx.flags.declared('system').filter(n => ctx.flags.isOn(n))",
  ability: "ctx.flags.declared('ability').filter(n => ctx.flags.isOn(n))",
  feature: "ctx.flags.declared('feature').filter(n => ctx.flags.isOn(n))",
};

const DX_CODE: Record<string, string> = {
  errors: "ctx.contexts.dx.run().filter(i => i.level === 'error').length",
  warnings: "ctx.contexts.dx.run().filter(i => i.level === 'warn').length",
};

/** Build the clickable tree. Each level passes its computed `code` to its
 *  children. Optional chaining (`?.`) is inserted after any indexed access so
 *  generated assertions stay safe when the array is empty. */
export function snapshotTree(snap: Snapshot): SnapshotNode {
  return makeNode('snapshot', snap, 'ctx');
}

function pickCode(parentCode: string, key: string, segment: 'root' | 'graph' | 'selection' | 'flags' | 'dx' | 'plain', optional: boolean): string {
  if (segment === 'root' && ROOT_CODE[key]) return ROOT_CODE[key];
  if (segment === 'graph' && GRAPH_CODE[key]) return GRAPH_CODE[key];
  if (segment === 'selection' && SELECTION_CODE[key]) return SELECTION_CODE[key];
  if (segment === 'flags' && FLAGS_CODE[key]) return FLAGS_CODE[key];
  if (segment === 'dx' && DX_CODE[key]) return DX_CODE[key];
  return `${parentCode}${optional ? '?.' : '.'}${key}`;
}

function nextSegment(parent: 'root' | 'graph' | 'selection' | 'flags' | 'dx' | 'plain', key: string): typeof parent {
  if (parent === 'root') {
    if (key === 'graph') return 'graph';
    if (key === 'selection') return 'selection';
    if (key === 'flags') return 'flags';
    if (key === 'dx') return 'dx';
    return 'plain';
  }
  return 'plain';
}

function makeNode(label: string, value: unknown, code: string, segment: 'root' | 'graph' | 'selection' | 'flags' | 'dx' | 'plain' = 'root'): SnapshotNode {
  if (Array.isArray(value)) {
    return {
      label,
      code,
      value,
      kind: 'array',
      children: value.map((v, i) => makeNode(`[${i}]`, v, `${code}[${i}]`, 'plain')),
    };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      label,
      code,
      value,
      kind: 'object',
      children: entries.map(([k, v]) => {
        // Optional access for entries under an indexed parent so generated
        // assertions like `ctx.graphs.current.nodes()[0]?.Label?.text` survive
        // an empty list at replay time.
        const optional = /\]$/.test(code) || /\)$/.test(code);
        const childCode = pickCode(code, k, segment, optional);
        return makeNode(k, v, childCode, nextSegment(segment, k));
      }),
    };
  }
  return { label, code, value, kind: 'literal' };
}

/** Flatten the tree for searching. Each entry's path is its `code` so filters
 *  match the way a user would type the assertion. */
export function flattenSnapshotTree(node: SnapshotNode, out: SnapshotNode[] = []): SnapshotNode[] {
  out.push(node);
  node.children?.forEach(c => flattenSnapshotTree(c, out));
  return out;
}
