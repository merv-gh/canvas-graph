import { FACT_SUFFIXES, type RedrawScope } from '../types';

/** Classify an event name by suffix.
 *  - 'view.changed' → 'camera' (pan/zoom: move the layer transform, no rebuild)
 *  - any other '.changed' → 'nodes' (e.g. selection repaint, no list churn)
 *  - any other fact suffix → 'both' (data changed; lists + canvas both refresh)
 *  - non-fact     → null    (request events, render.*, app.start etc.) */
export const factScope = (name: string): RedrawScope | null => {
  if (name === 'view.changed') return 'camera';
  for (const suffix of FACT_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    return suffix === '.changed' ? 'nodes' : 'both';
  }
  return null;
};
