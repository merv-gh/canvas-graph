import { FACT_SUFFIXES, type RedrawScope } from '../types';

/** Classify an event name by suffix.
 *  - 'view.changed' → 'camera' (pan/zoom: move the layer transform, no rebuild)
 *  - '.changed', '.selected', '.focused' → 'nodes' (decoration repaint, no data churn)
 *  - any other fact suffix → 'both' (data changed; lists + canvas both refresh)
 *  - non-fact     → null    (request events, render.*, app.start etc.) */
export const factScope = (name: string): RedrawScope | null => {
  if (name === 'view.changed') return 'camera';
  for (const suffix of FACT_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    if (suffix === '.changed') return 'nodes';
    if (suffix === '.focused' || suffix === '.selected') return 'nodes.visual';
    return 'both';
  }
  return null;
};

/** Full event→scope classification, including the data-dependent special cases
 *  (visual-only node patches, pure-decoration set changes). The ONLY home for
 *  redraw-scope logic — the render scheduler calls this and nothing else, so a
 *  new special case is one edit here, not a second heuristic in render.ts. */
export const scopeForEvent = (name: string, data: unknown): RedrawScope | null => {
  // History availability only redraws its toolbar contribution explicitly;
  // rebuilding canvas nodes here would steal focus from the active item.
  if (name === 'history.changed') return null;
  if (name === 'graph.node.updated') {
    const d = data as { patch?: Record<string, unknown>; visual?: boolean } | undefined;
    if (d?.patch && !('Label' in d.patch)) return d.visual ? 'nodes.visual' : 'nodes';
  }
  // .changed events that are purely decoration / visual state — no node data
  // (Position, Size, Label) moved.
  if (name === 'selection.changed' || name === 'decoration.changed') return 'nodes.visual';
  return factScope(name);
};
