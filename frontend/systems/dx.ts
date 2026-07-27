import { collectionCreateCommand, collectionDeleteCommand, collectionKind, type AppCtx, type Models, type Registry } from '../core';
import { edgeLabelRects } from '../model/entities';
import { EntitySlots, Places } from '../types';
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
  const visibleCommandIds = new Set(ctx.contexts.commands.userVisible().map(c => c.id));
  const knownSlots = EntitySlots;

  ctx.model.nodeTypes().forEach(def => {
    if (!def.id.trim()) error('node-type.id-empty', 'node type has an empty id');
    if (!def.label.trim()) error('node-type.label-empty', `node type "${def.id}" has no label`);
    if (!def.category.trim()) error('node-type.category-empty', `node type "${def.id}" has no category`);
    if (!def.visual) error('node-type.visual-missing', `node type "${def.id}" has no visual primitive`);
    if (def.defaultSize && (!(def.defaultSize.w > 0) || !(def.defaultSize.h > 0))) {
      error('node-type.size-invalid', `node type "${def.id}" has invalid default size`);
    }
  });
  ctx.graphs.current.nodes().forEach(node => {
    if (!ctx.model.nodeType(node.NodeType)) warn('node-type.unknown', `node "${node.id}" uses unknown type "${node.NodeType}"`);
  });

  ctx.contexts.storage.defaultOwners().forEach(({ kind, origin }) => {
    if (!ctx.flags.isOn(origin)) error('defaults.owner-disabled', `"${kind}" defaults owned by disabled "${origin}"`);
  });

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

  // An ability is a promise the renderer has to keep. `draggable` without a
  // drag surface, `editable` without a title element, `resizeable` without a
  // handle: the command exists, the palette lists it, and nothing happens when
  // the user tries. Node cards shipped exactly that way — declared draggable,
  // draggable only from a toolbar grip — until somebody reported it.
  //
  // Checked against what is actually on the stage, so it can only speak about
  // kinds that have something drawn. That makes it progressive (PRINCIPLES 6):
  // silent on an empty canvas, loud the moment the shape is wrong.
  const RENDERED_ABILITY_CONVENTIONS: Record<string, { selector: string; hint: string }> = {
    editable: { selector: '[data-editable-title]', hint: 'the renderer must mark its title element' },
    draggable: { selector: '[data-drag-surface]', hint: 'the renderer must mark the area that drags the item' },
    resizeable: { selector: '[data-slot="resize"]', hint: 'the renderer must place a resize handle slot' },
  };
  const stageEl = ctx.contexts.places.el(Places.Stage);
  if (stageEl) ctx.model.entities().forEach(entityDef => {
    if (!entityDef.render) return;
    const drawn = [...stageEl.querySelectorAll(`[data-item-kind="${entityDef.kind}"]`)]
      .filter(el => !el.closest('.tool-panel, .item-toolbar'));
    if (!drawn.length) return;
    entityDef.abilities.forEach(abilityDef => {
      const convention = RENDERED_ABILITY_CONVENTIONS[abilityDef.id];
      if (!convention) return;
      const satisfied = drawn.some(el => el.matches(convention.selector) || el.querySelector(convention.selector));
      if (!satisfied) {
        warn('ability.unrendered', `entity "${entityDef.kind}" declares ${abilityDef.id} but nothing it renders matches ${convention.selector} — ${convention.hint}`);
      }
    });
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
  // Ratchets down, never up: keyboard + cancellation merged into `interaction`,
  // so 13 is the new ceiling.
  const CONTEXT_BUDGET = 13;
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
 *  smell that a label got buried under other wiring. The rectangles come from
 *  `edgeLabelRects`, the renderer's own placement, so this rule can only ever
 *  report what the user actually sees. (It used to re-derive a simplified
 *  midpoint offset and warn about positions no label had occupied for months.)
 *  Capped by edge count so the validator stays sub-frame on large graphs. */
function checkLabelOverlaps(ctx: AppCtx, warn: (rule: string, message: string) => void) {
  const graph = ctx.graphs.current;
  const edges = graph.edges();
  if (!edges.length || edges.length > 400) return; // perf guard for huge graphs
  const center = (id: string) => {
    const n = graph.getNode(id) as { Position?: { x: number; y: number } } | undefined;
    return n?.Position ?? null;
  };
  type Seg = { id: string; ax: number; ay: number; bx: number; by: number };
  const segs: Seg[] = [];
  for (const e of edges) {
    const f = center(e.From), t = center(e.To);
    if (f && t) segs.push({ id: e.id, ax: f.x, ay: f.y, bx: t.x, by: t.y });
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
  edgeLabelRects(graph).forEach((rect, id) => {
    const clash = segs.find(s => s.id !== id && segRect(s, rect));
    if (!clash) return;
    hits++;
    if (hits <= 8) warn('layout.label-overlap', `edge "${id}" label overlaps edge "${clash.id}" — run a layout or move the label`);
  });
  if (hits > 8) warn('layout.label-overlap', `…and ${hits - 8} more label/edge overlaps`);
}
