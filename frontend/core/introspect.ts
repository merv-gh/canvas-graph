import type { AppCtx, BusOriginIndex } from '../core';

/** Categories of thing the app contains. Everything in the running system fits
 *  into one of these. `event` is included so the self-graph can edge to it,
 *  but most callers will filter event nodes out for readability. */
export type IntrospectKind = 'system' | 'ability' | 'feature' | 'entity' | 'collection' | 'command' | 'event';

export type IntrospectRef = { kind: IntrospectKind; id: string };
export type IntrospectNode = IntrospectRef & { label: string; meta?: Record<string, unknown> };

export type IntrospectRelation =
  | 'requires'    // system/ability/feature → required system/ability/feature
  | 'owns'        // system → command (via origin tag)
  | 'fires'       // command → event
  | 'subscribes'  // system/ability/feature → event (from bus origin map)
  | 'emits'       // system/ability/feature → event (from bus origin map)
  | 'declares'    // entity → ability
  | 'lists'       // collection → entity (matched on kind)
  | 'creates';    // collection → command (collection's create command)

export type IntrospectEdge = { from: IntrospectRef; to: IntrospectRef; relation: IntrospectRelation };

export type IntrospectSnapshot = { nodes: IntrospectNode[]; edges: IntrospectEdge[] };

/** Build a structural snapshot of the running app. Sources its data from
 *  flags (system/ability/feature), commands (with origin tag), the model
 *  (entities + abilities + collections), and the bus origin index
 *  (subscribes/emits). No new tracking required — this is a pure read.
 *
 *  Used by the self-graph demo and surfaced for tests/devtools. */
export function introspect(ctx: AppCtx): IntrospectSnapshot {
  const bus = ctx.bus as Partial<BusOriginIndex>;
  const nodes: IntrospectNode[] = [];
  const edges: IntrospectEdge[] = [];
  const seen = new Set<string>();
  const refKey = (ref: IntrospectRef) => `${ref.kind}:${ref.id}`;
  const ensure = (node: IntrospectNode) => {
    const key = refKey(node);
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push(node);
  };
  const edge = (from: IntrospectRef, to: IntrospectRef, relation: IntrospectRelation) => {
    edges.push({ from, to, relation });
  };
  const ownerKindOf = (origin: string): IntrospectKind => ctx.flags.kind(origin) ?? 'system';

  (['system', 'ability', 'feature'] as const).forEach(kind => {
    ctx.flags.declared(kind).forEach(name => {
      ensure({ kind, id: name, label: name });
      ctx.flags.requires(name).forEach(dep => {
        ensure({ kind: ctx.flags.kind(dep) ?? 'system', id: dep, label: dep });
        edge({ kind, id: name }, { kind: ctx.flags.kind(dep) ?? 'system', id: dep }, 'requires');
      });
    });
  });

  ctx.contexts.commands.all().forEach(cmd => {
    ensure({ kind: 'command', id: cmd.id, label: cmd.label, meta: { hidden: !!cmd.hidden, group: cmd.group } });
    ensure({ kind: 'event', id: cmd.event, label: cmd.event });
    if (cmd.origin) {
      const ownerKind = ownerKindOf(cmd.origin);
      ensure({ kind: ownerKind, id: cmd.origin, label: cmd.origin });
      edge({ kind: ownerKind, id: cmd.origin }, { kind: 'command', id: cmd.id }, 'owns');
    }
    edge({ kind: 'command', id: cmd.id }, { kind: 'event', id: cmd.event }, 'fires');
  });

  ctx.model.entities().forEach(entityDef => {
    ensure({ kind: 'entity', id: entityDef.kind, label: entityDef.label });
    entityDef.abilities.forEach(abilityDef => {
      const id = `ability.${abilityDef.id}`;
      ensure({ kind: 'ability', id, label: id });
      edge({ kind: 'entity', id: entityDef.kind }, { kind: 'ability', id }, 'declares');
    });
  });

  ctx.model.collections().forEach(collDef => {
    ensure({ kind: 'collection', id: collDef.id, label: collDef.label });
    if (collDef.kind) {
      ensure({ kind: 'entity', id: collDef.kind, label: collDef.kind });
      edge({ kind: 'collection', id: collDef.id }, { kind: 'entity', id: collDef.kind }, 'lists');
    }
  });

  if (bus._subscriptionsOf && bus._emissionsOf) {
    (['system', 'ability', 'feature'] as const).forEach(kind => {
      ctx.flags.declared(kind).forEach(origin => {
        bus._subscriptionsOf!(origin).forEach(eventName => {
          ensure({ kind: 'event', id: eventName, label: eventName });
          edge({ kind, id: origin }, { kind: 'event', id: eventName }, 'subscribes');
        });
        bus._emissionsOf!(origin).forEach(eventName => {
          ensure({ kind: 'event', id: eventName, label: eventName });
          edge({ kind, id: origin }, { kind: 'event', id: eventName }, 'emits');
        });
      });
    });
  }

  return { nodes, edges };
}
