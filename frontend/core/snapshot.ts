import { itemFoldId, type AppCtx } from '../core';

/** One node in the inspectable state tree. `code` is the TypeScript expression
 *  a test would use to read this value from a booted `ctx` — clicking a leaf
 *  in the assert modal generates an assertion against this expression. `path`
 *  is the natural snapshot-shaped key chain ("ui.places.stage.width") — what
 *  a user types when filtering the tree. */
export type SnapshotNode = {
  /** Human label for the tree row (object key, array index, etc.). */
  label: string;
  /** Dot-path through the snapshot POJO — used for filtering. */
  path: string;
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
  const ui = captureUi(ctx);
  const graph = ctx.graphs.current;
  const containers = graph.itemsOfKind('container') as Array<{
    id: string; Label?: { text: string }; Collapsed?: boolean; Position?: unknown; Size?: unknown; Children?: unknown; Sections?: unknown; SectionAxis?: unknown; ChildSections?: unknown;
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
        NodeType: n.NodeType,
        Description: n.Description,
        Collapsed: ctx.contexts.fold.folded(itemFoldId({ kind: 'node', id: n.id }, graph.id)),
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
        Collapsed: ctx.contexts.fold.folded(itemFoldId({ kind: 'container', id: c.id }, graph.id)),
        Position: c.Position,
        Size: c.Size,
        Sections: c.Sections,
        SectionAxis: c.SectionAxis,
        ChildSections: c.ChildSections,
        Children: c.Children,
      })),
    },
    selection: {
      selected: ctx.selection.selected(),
      focused: ctx.selection.focused(),
      count: ctx.selection.selectedAll().length,
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
    ui,
  };
}

/** UI/DOM-side snapshot — what the user actually sees. Counts what's rendered
 *  per kind, whether each place is mounted with non-zero size, and whether key
 *  surfaces (stage empty-state, item-toolbar, modal) are visible.
 *
 *  Code paths point at `ctx.contexts.places.el(...)` and `querySelectorAll`,
 *  which work identically in jsdom (tests) and the browser (recording). */
function captureUi(ctx: AppCtx) {
  const placeEl = (place: 'top' | 'left' | 'stage' | 'modal') => ctx.contexts.places.el(place);
  const stageEl = placeEl('stage');
  const modalEl = placeEl('modal');
  const topEl = placeEl('top');
  const leftEl = placeEl('left');
  const shellEl = topEl?.parentElement ?? null;
  const toolPanelInfo = (id: string) => {
    const place = id === 'top' ? topEl : stageEl;
    const el = place?.querySelector(`.tool-panel[data-panel-id="${id}"]`) as HTMLElement | null;
    return {
      mounted: !!el,
      collapsed: el?.dataset.collapsed === 'true',
      x: Math.round(Number.parseFloat(el?.style.left || '0')),
      y: Math.round(Number.parseFloat(el?.style.top || '0')),
      dragHandle: !!el?.querySelector('[data-tool-panel-drag]'),
      collapseHandle: !!el?.querySelector('[data-fold-id="shell.top"]'),
    };
  };
  const sizeOf = (el: HTMLElement | null) => {
    if (!el) return { mounted: false, width: 0, height: 0 };
    const rect = el.getBoundingClientRect();
    return { mounted: true, width: Math.round(rect.width), height: Math.round(rect.height) };
  };
  const count = (selector: string) => stageEl?.querySelectorAll(selector).length ?? 0;
  const leftCount = (selector: string) => leftEl?.querySelectorAll(selector).length ?? 0;
  // Modal field values + which field has focus. The seam for properties/modal
  // input bugs ("typing resets after one char" / "focus lost on a keystroke"):
  // a redraw that rebuilds the modal blurs the active input and drops the
  // in-progress value — invisible until ui.modal.focusedField / .fields exist.
  const modalFields: Record<string, string> = {};
  modalEl?.querySelectorAll('[data-field]').forEach(el => {
    const field = el.getAttribute('data-field');
    if (field) modalFields[field] = (el as HTMLInputElement).value ?? '';
  });
  const activeEl = (modalEl?.ownerDocument ?? document).activeElement as HTMLElement | null;
  const focusedField = activeEl && modalEl?.contains(activeEl) ? activeEl.getAttribute('data-field') : null;
  return {
    places: {
      top: sizeOf(topEl),
      left: sizeOf(leftEl),
      stage: sizeOf(stageEl),
      modal: sizeOf(modalEl),
    },
    shell: {
      topFolded: shellEl?.dataset.topFolded === 'true',
      zen: shellEl?.dataset.zen === 'true',
    },
    colorscheme: shellEl?.dataset.colorscheme ?? shellEl?.getAttribute('data-theme') ?? 'light',
    rendered: {
      nodes: count('.node[data-item-kind="node"]'),
      textNodes: count('.node-type-text[data-item-kind="node"]'),
      squareNodes: count('.node-type-square[data-item-kind="node"]'),
      circleNodes: count('.node-type-circle[data-item-kind="node"]'),
      describedNodes: count('.node.has-description[data-item-kind="node"]'),
      edges: count('[data-item-kind="edge"]'),
      containers: count('.container[data-item-kind="container"]'),
      sectionedContainers: count('.container.has-sections[data-item-kind="container"]'),
      overlays: count('.item-overlay'),
    },
    stage: {
      emptyStateVisible: !!stageEl?.querySelector('.empty'),
      itemToolbarVisible: !!stageEl?.querySelector('.item-toolbar'),
      marqueeVisible: !!stageEl?.querySelector('.select-marquee'),
    },
    // Presentation-mode lens — active flag, content mode, current focus node, and
    // how many neighbour cards / overflow chips the frame is showing.
    present: {
      active: shellEl?.dataset.present === 'true',
      mode: shellEl?.dataset.presentMode ?? 'nodes',
      focusId: shellEl?.dataset.presentFocus || null,
      neighbours: Number(shellEl?.dataset.presentNeighbours ?? 0),
      overflow: shellEl?.dataset.presentOverflow === 'true',
    },
    toolPanels: {
      top: toolPanelInfo('top'),
    },
    // Outline shape — how nesting actually renders in the left pane. `nested`
    // counts rows that live inside a parent's children block, so a recorded
    // "move into container" session can assert that the tree deepened.
    outline: {
      sections: leftCount('.outline-section'),
      rows: leftCount('.outline-row'),
      nested: leftCount('.outline-children .outline-row'),
    },
    modal: {
      open: !!modalEl?.querySelector('.modal-layer'),
      fields: modalFields,
      focusedField,
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
  ui: '/* see UI sub-paths */',
};

/** DOM-side helpers — each picked assertion under `ui.*` resolves to a query
 *  on the live element tree, so a regression test catches both "data is right"
 *  AND "the user actually sees it". */
const PLACES_CODE: Record<string, string> = {
  top: "ctx.contexts.places.el('top')?.getBoundingClientRect()",
  left: "ctx.contexts.places.el('left')?.getBoundingClientRect()",
  stage: "ctx.contexts.places.el('stage')?.getBoundingClientRect()",
  modal: "ctx.contexts.places.el('modal')?.getBoundingClientRect()",
};
const SHELL_CODE: Record<string, string> = {
  topFolded: "ctx.contexts.places.el('top')?.parentElement?.dataset.topFolded === 'true'",
  zen: "ctx.contexts.places.el('top')?.parentElement?.dataset.zen === 'true'",
};
const COLORSCHEME_CODE: Record<string, string> = {
  colorscheme: "(ctx.contexts.places.el('top')?.parentElement?.dataset.colorscheme ?? ctx.contexts.places.el('top')?.parentElement?.getAttribute('data-theme') ?? 'light')",
};
const RENDERED_CODE: Record<string, string> = {
  nodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node[data-item-kind=\"node\"]').length",
  textNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node-type-text[data-item-kind=\"node\"]').length",
  squareNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node-type-square[data-item-kind=\"node\"]').length",
  circleNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node-type-circle[data-item-kind=\"node\"]').length",
  describedNodes: "ctx.contexts.places.el('stage')?.querySelectorAll('.node.has-description[data-item-kind=\"node\"]').length",
  edges: "ctx.contexts.places.el('stage')?.querySelectorAll('[data-item-kind=\"edge\"]').length",
  containers: "ctx.contexts.places.el('stage')?.querySelectorAll('.container[data-item-kind=\"container\"]').length",
  sectionedContainers: "ctx.contexts.places.el('stage')?.querySelectorAll('.container.has-sections[data-item-kind=\"container\"]').length",
  overlays: "ctx.contexts.places.el('stage')?.querySelectorAll('.item-overlay').length",
};
const STAGE_CODE: Record<string, string> = {
  emptyStateVisible: "!!ctx.contexts.places.el('stage')?.querySelector('.empty')",
  itemToolbarVisible: "!!ctx.contexts.places.el('stage')?.querySelector('.item-toolbar')",
  marqueeVisible: "!!ctx.contexts.places.el('stage')?.querySelector('.select-marquee')",
};
const PRESENT_CODE: Record<string, string> = {
  active: "ctx.contexts.places.el('top')?.parentElement?.dataset.present === 'true'",
  mode: "(ctx.contexts.places.el('top')?.parentElement?.dataset.presentMode ?? 'nodes')",
  focusId: "(ctx.contexts.places.el('top')?.parentElement?.dataset.presentFocus || null)",
  neighbours: "Number(ctx.contexts.places.el('top')?.parentElement?.dataset.presentNeighbours ?? 0)",
  overflow: "ctx.contexts.places.el('top')?.parentElement?.dataset.presentOverflow === 'true'",
};
const MODAL_CODE: Record<string, string> = {
  open: "!!ctx.contexts.places.el('modal')?.querySelector('.modal-layer')",
  focusedField: "(() => { const a = document.activeElement; const m = ctx.contexts.places.el('modal'); return a && m?.contains(a) ? a.getAttribute('data-field') : null; })()",
};
const OUTLINE_CODE: Record<string, string> = {
  sections: "ctx.contexts.places.el('left')?.querySelectorAll('.outline-section').length",
  rows: "ctx.contexts.places.el('left')?.querySelectorAll('.outline-row').length",
  nested: "ctx.contexts.places.el('left')?.querySelectorAll('.outline-children .outline-row').length",
};
const TOOL_PANEL_CODE: Record<string, string> = {
  top: "ctx.contexts.places.el('stage')?.querySelector('.tool-panel[data-panel-id=\"top\"]')",
};

/** Selection has method-shaped readers (`selected()`, `focused()`) instead of
 *  plain properties. Map those too so generated tests look idiomatic. */
const SELECTION_CODE: Record<string, string> = {
  selected: 'ctx.selection.selected()',
  focused: 'ctx.selection.focused()',
  count: 'ctx.selection.selectedAll().length',
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
  return makeNode('snapshot', snap, 'ctx', 'root', '');
}

type Segment =
  | 'root'
  | 'graph' | 'selection' | 'flags' | 'dx'
  | 'ui' | 'ui.places' | 'ui.shell' | 'ui.colorscheme' | 'ui.rendered' | 'ui.stage' | 'ui.modal' | 'ui.outline' | 'ui.toolPanels' | 'ui.present'
  | 'plain';

function pickCode(parentCode: string, key: string, segment: Segment, optional: boolean): string {
  if (segment === 'root' && ROOT_CODE[key]) return ROOT_CODE[key];
  if (segment === 'graph' && GRAPH_CODE[key]) return GRAPH_CODE[key];
  if (segment === 'selection' && SELECTION_CODE[key]) return SELECTION_CODE[key];
  if (segment === 'flags' && FLAGS_CODE[key]) return FLAGS_CODE[key];
  if (segment === 'dx' && DX_CODE[key]) return DX_CODE[key];
  if (segment === 'ui.places' && PLACES_CODE[key]) return PLACES_CODE[key];
  if (segment === 'ui.shell' && SHELL_CODE[key]) return SHELL_CODE[key];
  if (segment === 'ui.colorscheme' && COLORSCHEME_CODE[key]) return COLORSCHEME_CODE[key];
  if (segment === 'ui.rendered' && RENDERED_CODE[key]) return RENDERED_CODE[key];
  if (segment === 'ui.stage' && STAGE_CODE[key]) return STAGE_CODE[key];
  if (segment === 'ui.modal' && MODAL_CODE[key]) return MODAL_CODE[key];
  if (segment === 'ui.outline' && OUTLINE_CODE[key]) return OUTLINE_CODE[key];
  if (segment === 'ui.toolPanels' && TOOL_PANEL_CODE[key]) return TOOL_PANEL_CODE[key];
  if (segment === 'ui.present' && PRESENT_CODE[key]) return PRESENT_CODE[key];
  return `${parentCode}${optional ? '?.' : '.'}${key}`;
}

function nextSegment(parent: Segment, key: string): Segment {
  if (parent === 'root') {
    if (key === 'graph') return 'graph';
    if (key === 'selection') return 'selection';
    if (key === 'flags') return 'flags';
    if (key === 'dx') return 'dx';
    if (key === 'ui') return 'ui';
    return 'plain';
  }
  if (parent === 'ui') {
    if (key === 'places') return 'ui.places';
    if (key === 'shell') return 'ui.shell';
    if (key === 'colorscheme') return 'ui.colorscheme';
    if (key === 'rendered') return 'ui.rendered';
    if (key === 'stage') return 'ui.stage';
    if (key === 'modal') return 'ui.modal';
    if (key === 'outline') return 'ui.outline';
    if (key === 'toolPanels') return 'ui.toolPanels';
    if (key === 'present') return 'ui.present';
  }
  return 'plain';
}

function makeNode(label: string, value: unknown, code: string, segment: Segment = 'root', path = ''): SnapshotNode {
  if (Array.isArray(value)) {
    return {
      label,
      path,
      code,
      value,
      kind: 'array',
      children: value.map((v, i) => makeNode(`[${i}]`, v, `${code}[${i}]`, 'plain', `${path}[${i}]`)),
    };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return {
      label,
      path,
      code,
      value,
      kind: 'object',
      children: entries.map(([k, v]) => {
        // Optional access for entries under an indexed parent so generated
        // assertions like `ctx.graphs.current.nodes()[0]?.Label?.text` survive
        // an empty list at replay time.
        const optional = /\]$/.test(code) || /\)$/.test(code);
        const childCode = pickCode(code, k, segment, optional);
        const childPath = path ? `${path}.${k}` : k;
        return makeNode(k, v, childCode, nextSegment(segment, k), childPath);
      }),
    };
  }
  return { label, path, code, value, kind: 'literal' };
}

/** Flatten the tree for searching. Each entry's path is its `code` so filters
 *  match the way a user would type the assertion. */
export function flattenSnapshotTree(node: SnapshotNode, out: SnapshotNode[] = []): SnapshotNode[] {
  out.push(node);
  node.children?.forEach(c => flattenSnapshotTree(c, out));
  return out;
}
