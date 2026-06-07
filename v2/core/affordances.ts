import type { AffordanceSurface, Bus, SystemAffordance } from '../types';

/** System-level affordances (toolbar buttons, side-bar entries, list contributions).
 *  Entity affordances stay on EntityDef.abilities — they need per-item context.
 *  System affordances are context-free, so any system can contribute one. */
export function affordancesContext(bus: Bus) {
  const surfaceAffordances = new Map<AffordanceSurface, SystemAffordance[]>();
  return {
    contribute(aff: SystemAffordance) {
      const list = surfaceAffordances.get(aff.surface) ?? [];
      list.push(aff);
      surfaceAffordances.set(aff.surface, list);
      bus.emit('affordance.contributed', { surface: aff.surface });
    },
    for(surface: AffordanceSurface) {
      const list = [...(surfaceAffordances.get(surface) ?? [])];
      return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    unregisterOrigin(origin: string) {
      for (const [surface, list] of surfaceAffordances) {
        const next = list.filter(a => a.origin !== origin);
        surfaceAffordances.set(surface, next);
        if (next.length !== list.length) bus.emit('affordance.contributed', { surface });
      }
    },
  };
}
