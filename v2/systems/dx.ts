import type { AppCtx, Models, Registry } from '../core';
import type { CommandSpec, DxIssue } from '../types';

type TemplateDebug = { _cloned?: Set<string> };
type BusDebug = { _subscribed?: Set<string>; _emitted?: Set<string> };

export function registerDx(system: Registry) {
  system('dx', (ctx) => {
    ctx.expose('dx', { run: () => runDx(ctx) });
    ctx.on('app.start', () => {
      queueMicrotask(() => {
        const issues = runDx(ctx);
        ctx.contexts.dx._set(issues);
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
      });
    });
  }));

  ctx.model.collections().forEach(collectionDef => {
    if (!commandIds.has(collectionDef.crud.create)) error('collection.no-create', `${collectionDef.id} missing create command ${collectionDef.crud.create}`);
    if (!commandIds.has(collectionDef.crud.delete)) error('collection.no-delete', `${collectionDef.id} missing delete command ${collectionDef.crud.delete}`);
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
  const seenBindings = new Map<string, CommandSpec>();
  ctx.contexts.commands.enabled().forEach(c => {
    const key = bindingKey(c); if (!key) return;
    const prev = seenBindings.get(key);
    if (prev) warn('binding.duplicate', `commands "${prev.id}" and "${c.id}" share input binding ${key}`);
    else seenBindings.set(key, c);
  });

  const paletteOwners = new Map<string, string>();
  ctx.model.entities().forEach(entityDef => entityDef.abilities.forEach(abilityDef => {
    abilityDef.actions.forEach(actionDef => {
      if (!actionDef.paletteCommand) return;
      const prev = paletteOwners.get(actionDef.paletteCommand);
      if (prev) error('action.palette-shared', `paletteCommand "${actionDef.paletteCommand}" is the canonical for both "${prev}" and "${actionDef.id}"`);
      else paletteOwners.set(actionDef.paletteCommand, actionDef.id);
    });
  }));

  ((ctx.contexts.templates as unknown as TemplateDebug)._cloned ?? new Set()).forEach(name => {
    if (!document.getElementById(`tpl-${name}`)) error('template.missing', `templates.clone("${name}") but no <template id="tpl-${name}"> exists`);
  });

  commands.forEach(c => {
    if (!c.origin) error('command.no-origin', `command "${c.id}" has no origin — won't unregister when its system flag flips`);
  });

  ctx.flags.declared().forEach(name => {
    if (!ctx.flags.isOn(name)) return;
    const missing = ctx.flags.requires(name).filter(dep => !ctx.flags.isOn(dep));
    if (missing.length) warn('requires.unmet', `"${name}" is on but its dependencies are off: ${missing.join(', ')}`);
  });

  const bus = ctx.bus as unknown as BusDebug;
  const knownKinds = new Set(ctx.model.entities().map(e => e.kind));
  const collectionKinds = new Set(ctx.model.collections().map(c => c.entity?.kind).filter(Boolean) as string[]);
  const eventKinds = new Set<string>();
  ([...(bus._subscribed ?? []), ...(bus._emitted ?? [])] as string[]).forEach(name => {
    const m = name.match(/^graph\.([a-z]+)\.(?:create|created|update|updated|delete|deleted)$/);
    if (m) eventKinds.add(m[1]);
  });
  eventKinds.forEach(kind => {
    if (!knownKinds.has(kind)) warn('entity.kind-no-declaration', `bus emits/handles graph.${kind}.* but no entity is declared for "${kind}"`);
    if (!collectionKinds.has(kind)) warn('entity.kind-no-collection', `kind "${kind}" has no collection — it won't appear in outline / palette`);
  });

  return issues;
}
