/**
 * Embeddable library entry.
 *
 * The dev app (`app.ts`) boots itself into `#app`. This entry instead exposes
 * `createGraphViewer(target, hooks)` so a host page (e.g. file-projections' UI)
 * can mount a read-only, interactive program-graph viewer into any element and
 * get node/edge click callbacks to wire into its own code navigation.
 *
 * Self-contained: the bundle injects its own CSS (`styles.css`) and the DOM
 * `<template>`s it needs (extracted from `index.html`), so the host only has to
 * drop in one script and call one function.
 *
 * Single-instance: the renderer resolves one global mount root (see
 * `core/mount.ts`), so one viewer per page for now.
 */
import cssText from './styles.css?inline';
import indexHtml from './index.html?raw';
import { registerAbilitySystems } from './abilities';
import { createAppContext, memoryIo, registry, withKind, type AppCtx } from './core';
import { setMountRoot } from './core/mount';
import { registerFeatures } from './features';
import { appModel, graphStore } from './model';
import { installRuntimeFeatureManager } from './runtime';
import { registerSystems } from './systems';
import { readableGraph, sgGraphToSnapshot, type SnapshotOptions, type VfEdge, type VfGraph, type VfNode } from './systems/varflow';

export type { VfGraph, VfNode, VfEdge } from './systems/varflow';

export type NodeClickInfo = {
  id: string;
  label: string;
  service?: string;
  kind?: string;
  file?: string;
  line?: number;
  effects?: string[];
  raw: VfNode;
};
export type EdgeClickInfo = {
  id: string;
  from: string;
  to: string;
  kind?: string;
  label?: string;
  cross?: boolean;
  source?: NodeClickInfo;
  target?: NodeClickInfo;
};
export type GraphViewerLoadResult = { nodes: number; edges: number; totalNodes: number; totalEdges: number; mode: string };

export type GraphViewerHooks = {
  /** Fired when a node is clicked. Use `file`/`line` to jump into source. */
  onNodeClick?: (info: NodeClickInfo) => void;
  /** Fired when an edge is clicked. */
  onEdgeClick?: (info: EdgeClickInfo) => void;
  /** Fired on any selection change (node, edge, or null when cleared). */
  onSelect?: (info: NodeClickInfo | EdgeClickInfo | null) => void;
  /** Fired when the viewer changes visible graph slice (load, focus, show all). */
  onViewChange?: (info: GraphViewerLoadResult) => void;
};

export type GraphViewerOptions = GraphViewerHooks & {
  /** Element (or selector) to mount into. Its contents are replaced. */
  target: HTMLElement | string;
};

export type GraphViewer = {
  /** Replace the displayed graph. `layout: 'flow'` arranges nodes top-down
   *  (best for control-flow); the default clusters by service. */
  load: (graph: VfGraph, opts?: SnapshotOptions) => GraphViewerLoadResult;
  /** Show every node and edge, bypassing the overview lens. */
  showAll: () => GraphViewerLoadResult | null;
  /** Focus one node's path and near neighbors. */
  focus: (nodeId: string) => GraphViewerLoadResult | null;
  /** Re-frame the camera to fit all nodes. */
  fit: () => void;
  /** Programmatically select (and center) a node by id. */
  select: (nodeId: string) => void;
  /** Empty the graph. */
  clear: () => void;
  /** Tear down listeners and empty the mount element. */
  destroy: () => void;
  /** Escape hatch: the underlying app context. */
  ctx: AppCtx;
};

/** The class every mount root carries; also the scope all viewer CSS is
 *  rewritten under so it can't leak into the host page. */
const SCOPE = '.graph-viewer-host';

/** Rewrite a stylesheet so every rule only applies inside the mount root.
 *  - page-level `html`/`body` rules are dropped (the host sizes the element)
 *  - `:root` (design tokens) is remapped to the scope so vars cascade in
 *  - everything else is prefixed with the scope selector
 *  Keyframes stay global; @media/@supports are recursed into. */
function scopeCss(css: string): string {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const scopeSelector = (sel: string) =>
    sel.split(',').map(part => {
      const s = part.trim();
      if (!s) return s;
      if (s === 'html' || s === 'body') return SCOPE;
      if (s.startsWith('html ') || s.startsWith('body ')) return `${SCOPE} ${s.slice(s.indexOf(' ') + 1)}`;
      // `:root` (design tokens) and `.varflow` (viewer theme) both target the
      // mount root itself — remap them to the scope rather than nesting under it.
      if (s.includes(':root') || s.includes('.varflow')) return s.replace(/:root/g, SCOPE).replace(/\.varflow/g, SCOPE);
      return `${SCOPE} ${s}`;
    }).join(', ');
  const render = (rules: CSSRuleList): string => {
    let out = '';
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        // A `html`/`body`-only rule scoped away to the host itself would force
        // the element to 100vh etc — drop those page-level rules entirely.
        const raw = rule.selectorText.trim();
        if (raw === 'html' || raw === 'body') continue;
        out += `${scopeSelector(rule.selectorText)}{${rule.style.cssText}}\n`;
      } else if (rule instanceof CSSMediaRule) {
        out += `@media ${rule.conditionText}{${render(rule.cssRules)}}\n`;
      } else if (rule instanceof CSSSupportsRule) {
        out += `@supports ${rule.conditionText}{${render(rule.cssRules)}}\n`;
      } else {
        out += `${rule.cssText}\n`; // keyframes, font-face, etc. — keep global
      }
    }
    return out;
  };
  return render(sheet.cssRules);
}

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || document.getElementById('graph-viewer-styles')) return;
  const style = document.createElement('style');
  style.id = 'graph-viewer-styles';
  style.textContent = scopeCss(cssText);
  document.head.appendChild(style);
  stylesInjected = true;
}

function ensureTemplates() {
  const doc = new DOMParser().parseFromString(indexHtml, 'text/html');
  doc.querySelectorAll('template[id]').forEach(tpl => {
    if (!document.getElementById(tpl.id)) document.body.appendChild(tpl.cloneNode(true));
  });
}

const nodeInfo = (n: VfNode): NodeClickInfo => ({
  id: n.id,
  label: n.label || n.method || n.id,
  service: n.service,
  kind: n.kind,
  file: n.file,
  line: n.line,
  effects: n.effects,
  raw: n,
});

function serviceContainersFor(graph: VfGraph) {
  const groups = new Map<string, string[]>();
  (graph.nodes ?? []).forEach(n => {
    const service = n.service || 'other';
    (groups.get(service) ?? groups.set(service, []).get(service)!).push(n.id);
  });
  return [...groups.entries()]
    .filter(([, children]) => children.length > 1)
    .map(([service, children], i) => ({
      id: `vf-svc-${i + 1}-${service.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      label: service,
      children,
    }));
}

export function createGraphViewer(opts: GraphViewerOptions): GraphViewer {
  const target = typeof opts.target === 'string'
    ? document.querySelector<HTMLElement>(opts.target)
    : opts.target;
  if (!target) throw new Error(`createGraphViewer: target not found: ${String(opts.target)}`);

  ensureStyles();
  ensureTemplates();
  setMountRoot(target);
  target.classList.add('varflow', 'graph-viewer-host');

  const plugins = registry();
  registerSystems(withKind(plugins, 'system'));
  registerAbilitySystems(withKind(plugins, 'ability'));
  registerFeatures(withKind(plugins, 'feature'));
  const ctx = createAppContext(graphStore(), appModel, {}, memoryIo());
  installRuntimeFeatureManager(ctx, plugins);
  plugins.start(ctx);
  ctx.bus.emit('app.start');

  // Click resolution: the model only stores label/type, so keep the original
  // file-projections node/edge metadata here, keyed the same way the adapter
  // keys them (edge ids are r1.. over the filtered edge list).
  let rawGraph: VfGraph | null = null;
  let currentOpts: SnapshotOptions = {};
  let nodeMeta = new Map<string, VfNode>();
  let edgeMeta = new Map<string, EdgeClickInfo>();
  let suppressSelection = false;

  const readableDefaults = (viewOpts: SnapshotOptions): SnapshotOptions => {
    if (viewOpts.layout === 'flow' || viewOpts.readMode === 'all') return viewOpts;
    const width = target.getBoundingClientRect().width || window.innerWidth;
    const caps = width <= 460
      ? { maxOverviewNodes: 4, maxFocusNodes: 6, expandDepth: 0 }
      : width <= 760
        ? { maxOverviewNodes: 12, maxFocusNodes: 16, expandDepth: 1 }
        : { maxOverviewNodes: 18, maxFocusNodes: 24, expandDepth: 1 };
    return { ...caps, ...viewOpts };
  };

  const resolveSelection = (kind: string, id: string): NodeClickInfo | EdgeClickInfo | null => {
    if (kind === 'node') { const n = nodeMeta.get(id); return n ? nodeInfo(n) : null; }
    if (kind === 'edge') return edgeMeta.get(id) ?? null;
    return null;
  };

  const off = ctx.bus.on('selection.changed', (data: unknown) => {
    const refs = (data as { refs?: { kind: string; id: string }[] }).refs ?? [];
    const primary = refs[refs.length - 1];
    if (!primary) { opts.onSelect?.(null); return; }
    const info = resolveSelection(primary.kind, primary.id);
    if (!info) return;
    if (suppressSelection) return;
    if (primary.kind === 'node') opts.onNodeClick?.(info as NodeClickInfo);
    if (primary.kind === 'edge') opts.onEdgeClick?.(info as EdgeClickInfo);
    opts.onSelect?.(info);
    if (primary.kind === 'node' && rawGraph && currentOpts.layout !== 'flow' && currentOpts.readMode !== 'all') {
      window.setTimeout(() => focus(primary.id), 0);
    }
  });

  const fit = () => ctx.bus.emit('view.fit.all');

  // Auto-fit when the mount element gains/changes size. Covers the common case
  // of the viewer living in a tab/panel that is display:none (zero-size) at
  // mount and only gets real dimensions once revealed — without this the first
  // load fits into a 0px box and renders nothing until a manual fit.
  let hasGraph = false;
  let resizeTimer = 0;
  const redrawAndFit = () => {
    // A camera fit alone won't create node elements that were culled when the
    // container had no size — force a full stage rebuild first, then frame it.
    ctx.bus.emit('render.stage.draw', { full: true, refs: [] });
    fit();
  };
  const ro = new ResizeObserver(() => {
    if (!hasGraph) return;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(redrawAndFit, 80);
  });
  ro.observe(target);

  const renderLoaded = (graph: VfGraph, viewOpts: SnapshotOptions = {}) => {
    viewOpts = readableDefaults(viewOpts);
    hasGraph = true;
    const raw = rawGraph?.nodes ?? graph.nodes ?? [];
    nodeMeta = new Map(raw.map(n => [n.id, n]));
    const slice = readableGraph(graph, viewOpts);
    const visible = slice.graph.nodes ?? [];
    const ids = new Set(visible.map(n => n.id));
    edgeMeta = new Map();
    (slice.graph.edges ?? [])
      .filter(e => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
      .forEach((e: VfEdge, i) => {
        edgeMeta.set(`r${i + 1}`, {
          id: `r${i + 1}`, from: e.from, to: e.to, kind: e.kind, label: e.label, cross: e.cross,
          source: nodeMeta.get(e.from) && nodeInfo(nodeMeta.get(e.from)!),
          target: nodeMeta.get(e.to) && nodeInfo(nodeMeta.get(e.to)!),
        });
      });
    const snapshot = sgGraphToSnapshot(slice.graph, viewOpts);
    ctx.bus.emit('graph.import.snapshot', snapshot);
    ctx.bus.emit('container.import.snapshot', { containers: viewOpts.layout === 'flow' ? [] : serviceContainersFor(slice.graph) });
    target.classList.add('varflow');
    // The import's auto-redraw can race the shell/stage mount on the very first
    // load, so force one full stage draw on the next frame, then frame it. In
    // 'flow' mode the nodes ship position-less — run the layered tidy layout.
    ctx.frameLoop.schedule('lib.render.after', () => {
      ctx.bus.emit('render.stage.draw', { full: true, refs: [] });
      if (viewOpts.layout === 'flow') ctx.bus.emit('layout.apply.tidy');
      fit();
      setTimeout(fit, 300);
    }, 30);
    const result = {
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
      totalNodes: slice.totalNodes,
      totalEdges: slice.totalEdges,
      mode: slice.mode,
    };
    opts.onViewChange?.(result);
    return result;
  };

  const load = (graph: VfGraph, opts: SnapshotOptions = {}) => {
    rawGraph = graph;
    currentOpts = opts;
    return renderLoaded(graph, opts);
  };

  const focus = (nodeId: string) => {
    if (!rawGraph) return null;
    suppressSelection = true;
    currentOpts = { ...currentOpts, focusNodeId: nodeId };
    const result = renderLoaded(rawGraph, currentOpts);
    ctx.frameLoop.schedule('lib.focus.after', () => {
      ctx.bus.emit('selection.node.select', { id: nodeId });
      window.setTimeout(() => { suppressSelection = false; }, 0);
    }, 30);
    return result;
  };

  const showAll = () => {
    if (!rawGraph) return null;
    currentOpts = { ...currentOpts, readMode: 'all', focusNodeId: undefined };
    return renderLoaded(rawGraph, currentOpts);
  };

  const select = (nodeId: string) => ctx.bus.emit('selection.node.select', { id: nodeId });
  const clear = () => {
    rawGraph = null;
    ctx.bus.emit('graph.import.snapshot', { nodes: [], edges: [] });
    ctx.bus.emit('container.import.snapshot', { containers: [] });
  };
  const destroy = () => { off(); ro.disconnect(); target.replaceChildren(); target.classList.remove('varflow', 'graph-viewer-host'); };

  return { load, showAll, focus, fit, select, clear, destroy, ctx };
}
