import { collectionCreateCommand, collectionDeleteCommand, collectionKind, type AppCtx, type Models, type Registry } from '../core';
import { EntitySlots } from '../types';
import type { CommandSpec, DxIssue } from '../types';

type TemplateDebug = { _cloned?: Set<string> };
type BusDebug = { _subscribed?: Set<string>; _emitted?: Set<string> };

export function registerDx(system: Registry) {
  system('dx', (ctx) => {
    ctx.expose('dx', { run: () => runDx(ctx) });
    // Same runner is reachable via `ctx.contexts.dx.run()` — survives the
    // shallow-spread of AppCtx into SystemCtx that earlier-registered systems
    // closed over.
    ctx.contexts.dx.setRunner(() => runDx(ctx));
    ctx.on('app.start', () => {
      queueMicrotask(() => {
        const issues = runDx(ctx);
        ctx.contexts.dx.setIssues(issues);
        const errors = issues.filter(i => i.level === 'error');
        const warns = issues.filter(i => i.level === 'warn');
        if (errors.length) {
          console.error('[dx] errors:');
          errors.forEach(i => console.error(`  ${i.rule}: ${i.message}`));
          throw new Error(`DX contract failed (${errors.length} error${errors.length > 1 ? 's' : ''}). See console.`);
        }
        if (warns.length) {
          console.warn(`[dx] ${warns.length} warning(s):`);
          warns.forEach(i => console.warn(`  ${i.rule}: ${i.message}`));
        } else {
          console.info('[dx] all checks passed');
        }
      });
    });
  });
}

/** Run DX checks against the live app context: model + commands + flags + observed runtime activity. */
export function runDx(ctx: AppCtx): DxIssue[] {
  const issues: DxIssue[] = [];
  const error = (rule: string, message: string) => issues.push({ level: 'error', rule, message });
  const warn = (rule: string, message: string) => issues.push({ level: 'warn', rule, message });

  const commands = ctx.contexts.commands.all();
  const commandIds = new Set(commands.map(c => c.id));
  const visibleCommandIds = new Set(commands.filter(c => !c.hidden).map(c => c.id));
  const knownSlots = EntitySlots;

  ctx.model.entities().forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    if (!abilityDef.actions.length) error('ability.no-actions', `${entityDef.kind}.${abilityDef.id} has no actions`);
    if (abilityDef.id === 'configurable' && !entityDef.properties?.length) {
      error('configurable.no-properties', `${entityDef.kind}.configurable declares no properties`);
    }
    abilityDef.actions.forEach(actionDef => {
      const paletteCmd = actionDef.paletteCommand != null ? ctx.contexts.commands.get(actionDef.paletteCommand) : undefined;
      if (actionDef.paletteCommand != null && (!paletteCmd || !visibleCommandIds.has(actionDef.paletteCommand))) {
        error('action.palette-missing', `${actionDef.id} missing visible palette command ${actionDef.paletteCommand}`);
      }
      // An action is "reachable" if it has at least one UI affordance OR its palette command
      // has an input binding (keyboard shortcut, click selector, pointer gesture, etc).
      const hasUi = actionDef.ui.length > 0;
      const hasInputBinding = !!paletteCmd?.input;
      if (!hasUi && !hasInputBinding) {
        error('action.no-affordance', `${actionDef.id} has neither a UI affordance nor an input-bound palette command`);
      }
      actionDef.ui.forEach(ui => {
        if (!commandIds.has(ui.command)) error('action.ui-command-missing', `${actionDef.id} UI missing command ${ui.command}`);
        // Slot names are a contract between abilities and renderers. If an
        // ability points at a slot the renderer doesn't know about, the
        // affordance silently vanishes — catch the typo at boot.
        if (ui.slot != null && !knownSlots.has(ui.slot)) {
          error('slot.unknown', `${actionDef.id} uses unknown slot "${ui.slot}" — add it to Slots in types.ts`);
        }
      });
    });
  }));

  // Patchable entities must have a storage handler — otherwise item.update
  // emits from drag/edit/configure/etc. fall on the floor. selectable on its
  // own doesn't patch; the rule fires for entities with patchable abilities or
  // declared properties.
  const PATCHABLE_ABILITIES = new Set(['draggable', 'nudgeable', 'editable', 'configurable', 'resizeable']);
  ctx.model.entities().forEach(entityDef => {
    const hasPatchable = entityDef.abilities.some(a => PATCHABLE_ABILITIES.has(a.id)) || (entityDef.properties?.length ?? 0) > 0;
    if (hasPatchable && !ctx.contexts.storage.has(entityDef.kind)) {
      error('storage.missing', `entity kind "${entityDef.kind}" has patchable abilities/properties but no storage handler`);
    }
  });

  ctx.model.collections().forEach(collectionDef => {
    const create = collectionCreateCommand(collectionDef);
    const del = collectionDeleteCommand(collectionDef);
    const missingId = collectionDef.items(ctx).some(item => !collectionDef.itemId(item));
    if (!commandIds.has(create)) error('collection.no-create', `${collectionDef.id} missing create command ${create}`);
    if (!commandIds.has(del)) error('collection.no-delete', `${collectionDef.id} missing delete command ${del}`);
    if (missingId) error('collection.item-id-missing', `${collectionDef.id} has an item without an id`);
    if (!collectionDef.search) error('collection.no-search', `${collectionDef.id} missing search`);
    if (!collectionDef.order) error('collection.no-order', `${collectionDef.id} missing order`);
  });

  const raw = (ctx.model as Models).rawEntities?.() ?? [];
  raw.forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    if (!ctx.flags.isOn(`ability.${abilityDef.id}`)) {
      warn('ability.disabled', `${entityDef.kind}.${abilityDef.id} is declared but its flag 'ability.${abilityDef.id}' is off`);
    }
  }));

  const bindingKey = (c: CommandSpec) => {
    const b = c.input; if (!b) return null;
    return [b.on, b.key ?? '', b.ctrl ? 'C' : '', b.shift ? 'S' : '', b.alt ? 'A' : '', b.meta ? 'M' : '', b.selector ?? ''].join('|');
  };
  const scopedBinding = (c: CommandSpec) => !!c.input?.when;
  const seenBindings = new Map<string, CommandSpec>();
  ctx.contexts.commands.enabled().forEach(c => {
    const key = bindingKey(c); if (!key) return;
    if (scopedBinding(c)) return;
    const prev = seenBindings.get(key);
    if (prev) warn('binding.duplicate', `commands "${prev.id}" and "${c.id}" share input binding ${key}`);
    else seenBindings.set(key, c);
  });

  // Each palette command should be canonical for exactly one ACTION identity
  // (action.id). The same action appearing on multiple entities (because they
  // share an ability — e.g. node + container are both `nudgeable`) is fine and
  // expected; that's the whole point of structural abilities. The rule fires
  // only when two DIFFERENT action ids point to the same paletteCommand.
  const paletteOwners = new Map<string, string>();
  ctx.model.entities().forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    abilityDef.actions.forEach(actionDef => {
      if (!actionDef.paletteCommand) return;
      const prev = paletteOwners.get(actionDef.paletteCommand);
      if (prev && prev !== actionDef.id) error('action.palette-shared', `paletteCommand "${actionDef.paletteCommand}" is the canonical for both "${prev}" and "${actionDef.id}"`);
      else if (!prev) paletteOwners.set(actionDef.paletteCommand, actionDef.id);
    });
  }));

  ((ctx.contexts.templates as unknown as TemplateDebug)._cloned ?? new Set()).forEach(name => {
    if (!document.getElementById(`tpl-${name}`)) error('template.missing', `templates.clone("${name}") but no <template id="tpl-${name}"> exists`);
  });

  commands.forEach(c => {
    if (!c.origin) error('command.no-origin', `command "${c.id}" has no origin — won't unregister when its system flag flips`);
  });

  // Contexts budget — ctx.contexts is the shared mental-model surface, so it
  // RATCHETS: adding a context means merging two others first (Principle:
  // concepts merge and split safely). 'teardown' is bookkeeping, not a concept.
  const CONTEXT_BUDGET = 14;
  const contextNames = Object.keys(ctx.contexts).filter(name => name !== 'teardown');
  if (contextNames.length > CONTEXT_BUDGET) {
    error('contexts.budget', `ctx.contexts has ${contextNames.length} contexts (budget ${CONTEXT_BUDGET}); merge two before adding one — ${contextNames.join(', ')}`);
  }

  ctx.flags.declared().forEach(name => {
    if (!ctx.flags.isOn(name)) return;
    const missing = ctx.flags.requires(name).filter(dep => !ctx.flags.isOn(dep));
    if (missing.length) warn('requires.unmet', `"${name}" is on but its dependencies are off: ${missing.join(', ')}`);
  });

  const bus = ctx.bus as unknown as BusDebug;
  const knownKinds = new Set(ctx.model.entities().map(e => e.kind));
  const collectionKinds = new Set(ctx.model.collections().map(c => collectionKind(c)));
  const eventKinds = new Set<string>();
  ([...(bus._subscribed ?? []), ...(bus._emitted ?? [])] as string[]).forEach(name => {
    const m = name.match(/^graph\.([a-z]+)\.(?:create|created|update|updated|delete|deleted)$/);
    if (m) eventKinds.add(m[1]);
  });
  eventKinds.forEach(kind => {
    if (!knownKinds.has(kind)) warn('entity.kind-no-declaration', `bus emits/handles graph.${kind}.* but no entity is declared for "${kind}"`);
    if (!collectionKinds.has(kind)) warn('entity.kind-no-collection', `kind "${kind}" has no collection — it won't appear in outline / palette`);
  });

  checkLabelOverlaps(ctx, warn);

  return issues;
}

/** Warn when an edge's label rect crosses a *different* edge's line — the layout
 *  smell that a multi-line label got buried under other wiring. Mirrors the
 *  renderer's right-of-direction offset (model/entities.ts) so the geometry it
 *  checks is the geometry the user sees. Capped by edge count so the validator
 *  stays sub-frame on large graphs. */
function checkLabelOverlaps(ctx: AppCtx, warn: (rule: string, message: string) => void) {
  const graph = ctx.graphs.current;
  const edges = graph.edges();
  if (!edges.length || edges.length > 400) return; // perf guard for huge graphs
  const LINE_H = 14, CHAR_W = 7;
  const center = (id: string) => {
    const n = graph.getNode(id) as { Position?: { x: number; y: number }; Size?: { w: number; h: number } } | undefined;
    return n?.Position ? { pos: n.Position, size: n.Size ?? { w: 160, h: 72 } } : null;
  };
  type Seg = { id: string; ax: number; ay: number; bx: number; by: number };
  const segs: Seg[] = [];
  for (const e of edges) {
    const f = center(e.From), t = center(e.To);
    if (f && t) segs.push({ id: e.id, ax: f.pos.x, ay: f.pos.y, bx: t.pos.x, by: t.pos.y });
  }
  const segRect = (s: Seg, r: { x: number; y: number; w: number; h: number }) => {
    // Segment vs axis-aligned rect: endpoint inside, or segment crosses a side.
    const inside = (x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    if (inside(s.ax, s.ay) || inside(s.bx, s.by)) return true;
    const cross = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) => {
      const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
      if (!d) return false;
      const u = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
      const v = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
      return u >= 0 && u <= 1 && v >= 0 && v <= 1;
    };
    return (
      cross(s.ax, s.ay, s.bx, s.by, r.x, r.y, r.x + r.w, r.y) ||
      cross(s.ax, s.ay, s.bx, s.by, r.x, r.y + r.h, r.x + r.w, r.y + r.h) ||
      cross(s.ax, s.ay, s.bx, s.by, r.x, r.y, r.x, r.y + r.h) ||
      cross(s.ax, s.ay, s.bx, s.by, r.x + r.w, r.y, r.x + r.w, r.y + r.h)
    );
  };
  let hits = 0;
  for (const e of edges) {
    const text = e.Label?.text;
    if (!text) continue;
    const f = center(e.From), t = center(e.To);
    if (!f || !t) continue;
    const lines = text.split(/\r?\n/);
    const dx = t.pos.x - f.pos.x, dy = t.pos.y - f.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const blockH = lines.length * LINE_H;
    const off = blockH / 2 + 8;
    const cx = (f.pos.x + t.pos.x) / 2 + (-dy / len) * off;
    const cy = (f.pos.y + t.pos.y) / 2 + (dx / len) * off;
    const w = Math.max(...lines.map(l => l.length)) * CHAR_W;
    const rect = { x: cx - w / 2, y: cy - blockH / 2, w, h: blockH };
    const clash = segs.find(s => s.id !== e.id && segRect(s, rect));
    if (clash) {
      hits++;
      if (hits <= 8) warn('layout.label-overlap', `edge "${e.id}" label overlaps edge "${clash.id}" — run a layout or move the label`);
    }
  }
  if (hits > 8) warn('layout.label-overlap', `…and ${hits - 8} more label/edge overlaps`);
}
