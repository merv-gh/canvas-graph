import { FACT_SUFFIXES, type RedrawScope } from '../types';

/** Classify an event name by suffix.
 *  - '.changed'  → 'nodes'  (camera/view repaint only, no entity churn)
 *  - any other fact suffix → 'both' (data changed; lists + canvas both need refresh)
 *  - non-fact     → null    (request events, render.*, app.start etc.) */
export const factScope = (name: string): RedrawScope | null => {
  for (const suffix of FACT_SUFFIXES) {
    if (!name.endsWith(suffix)) continue;
    return suffix === '.changed' ? 'nodes' : 'both';
  }
  return null;
};
