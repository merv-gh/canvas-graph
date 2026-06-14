import type {
  ActionDef,
  AffordanceDef,
  AffordanceSurface,
  Bus,
  EntityDef,
  SystemAffordance,
} from '../types';

/** Unified affordance lookup. Two kinds, one context:
 *
 *  - **system affordances** (toolbar buttons, sidebar entries) — context-free,
 *    contributed at boot via `contribute()`, retrieved by surface.
 *  - **entity affordances** (per-item buttons + handlers on a rendered card) —
 *    declared on `EntityDef.abilities[].actions[].ui`, retrieved by entity + slot.
 *
 *  Both flow through this one context so render reads from a single API and a
 *  future plugin can swap either side without touching the other. */
export function affordancesContext(bus: Bus) {
  const surfaceAffordances = new Map<AffordanceSurface, SystemAffordance[]>();
  return {
    contribute(aff: SystemAffordance) {
      const list = surfaceAffordances.get(aff.surface) ?? [];
      list.push(aff);
      surfaceAffordances.set(aff.surface, list);
      bus.emit('affordance.contributed', { surface: aff.surface });
    },
    /** Context-free affordances contributed for the given surface (toolbar, list, …). */
    system(surface: AffordanceSurface) {
      const list = [...(surfaceAffordances.get(surface) ?? [])];
      return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    /** Per-entity affordances declared on its abilities, optionally filtered by slot. */
    entity<T>(entityDef: EntityDef<T>, slot?: string) {
      return entityDef.abilities.flatMap(abilityDef => abilityDef.actions.flatMap(actionDef =>
        actionDef.ui
          .filter(ui => ui.surface === 'entity' && (slot == null || ui.slot === slot))
          .map(ui => ({ action: actionDef as ActionDef<T>, ui: ui as AffordanceDef<T> })),
      ));
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
