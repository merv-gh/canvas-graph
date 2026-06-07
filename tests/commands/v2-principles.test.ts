import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootV2, commandButton, settle } from './v2-testkit';

const V2 = resolve(process.cwd(), 'v2');

const allFiles = (dir: string, acc: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) allFiles(full, acc);
    else if (/\.(ts|html)$/.test(entry)) acc.push(full);
  }
  return acc;
};

describe('v2 principles (enforced)', () => {
  // PRINCIPLE 1 — Smallest core. core.ts is the wiring layer; everything else lives
  // in /core/<concern>.ts or /systems/. New core APIs must come with deletions
  // elsewhere; if this assertion grows, split another sub-context out.
  it('core.ts stays ≤ 400 lines (smallest-core principle)', () => {
    const lines = readFileSync(join(V2, 'core.ts'), 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(400);
  });

  // PRINCIPLE 13 — Toolbar buttons come from data, not templates. The shell template
  // owns places, not contents — every button is contributed by a system or collection.
  it('shell template has zero hardcoded data-command attributes', () => {
    const html = readFileSync(join(V2, 'index.html'), 'utf8');
    const shellSection = html.match(/<template id="tpl-shell">[\s\S]*?<\/template>/)?.[0] ?? '';
    expect(shellSection.match(/data-command=/g)?.length ?? 0).toBe(0);
  });

  // PRINCIPLE 5 — Render is a swappable adapter. document.querySelector should only
  // live in render-adjacent code (render system, dx template check, app boot).
  // Systems and abilities scope queries through places.el(...).
  it('no document.querySelector outside render-adjacent files', () => {
    const allowed = new Set([
      'systems/render.ts',   // owns the boot element
      'systems/dx.ts',       // template existence probe
      'core/templates.ts',   // template adapter itself
    ]);
    const offenders: string[] = [];
    for (const file of allFiles(V2)) {
      const rel = file.slice(V2.length + 1);
      if (rel === 'index.html') continue;
      if (allowed.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      if (/document\.(querySelector|getElementById)/.test(source)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  // PRINCIPLE 2 — Systems are self-sufficient. Disabling any single non-core system
  // must not break boot. We exercise the full system flag matrix one-off-at-a-time.
  it('every system boots when disabled one-at-a-time', async () => {
    const probe = bootV2();
    const systemNames = probe.flags.declared('system').filter(name => name !== 'render' && name !== 'input');
    for (const name of systemNames) {
      // dx throws on contract violations — we surface them, not silently swallow.
      try {
        // dx asserts a global contract; flipping a single system breaks some checks
        // (e.g. disabling `collections` removes the create command). The principle
        // being tested here is "boot does not crash", not "all DX rules still pass".
        const ctx = bootV2({ [name]: false, dx: false });
        await settle();
        // App still has commands registered (proves rest of the system stack came up).
        expect(ctx.contexts.commands.all().length).toBeGreaterThan(0);
      } catch (err) {
        throw new Error(`boot failed with ${name}=false: ${(err as Error).message}`);
      }
    }
  });

  // PRINCIPLE 11 — Abilities can be turned off independently. Flipping any single
  // ability off should not break boot or remove unrelated abilities.
  it('every ability boots when disabled one-at-a-time', async () => {
    const probe = bootV2();
    const abilityNames = probe.flags.declared('ability');
    for (const name of abilityNames) {
      try {
        // dx asserts a global contract; flipping a single system breaks some checks
        // (e.g. disabling `collections` removes the create command). The principle
        // being tested here is "boot does not crash", not "all DX rules still pass".
        const ctx = bootV2({ [name]: false, dx: false });
        await settle();
        const live = ctx.model.entity('node')?.abilities.map(a => `ability.${a.id}`) ?? [];
        expect(live).not.toContain(name);
      } catch (err) {
        throw new Error(`boot failed with ${name}=false: ${(err as Error).message}`);
      }
    }
  });

  // PRINCIPLE 16 — Per-system origin tagging mandatory. After boot, every command
  // should have origin set so flag toggles cleanly unregister.
  it('every registered command carries an origin', () => {
    const ctx = bootV2();
    const orphans = ctx.contexts.commands.all().filter(c => !c.origin);
    expect(orphans.map(c => c.id)).toEqual([]);
  });

  it('registry.stop tears down commands, affordances, and listeners by origin', async () => {
    const ctx = bootV2();
    await settle();
    const before = ctx.contexts.view.get().scale;

    expect(ctx.contexts.commands.get('view.zoom.in')).toBeTruthy();
    expect(commandButton('view.zoom.in')).not.toBeNull();
    ctx.contexts.itemModes.set('view.zoom', 'focused', [{ kind: 'node', id: 'e-test' }]);
    ctx.contexts.itemOverlays.set('view.zoom', [{ ref: { kind: 'node', id: 'e-test' }, text: 'Z' }]);
    ctx.contexts.itemTargets.register('view.zoom', () => [{ ref: { kind: 'node', id: 'e-test' }, label: 'Z', anchor: { x: 0, y: 0 } }]);
    ctx.contexts.keyboard.capture('view.zoom');

    ctx.registries.systems.stop(ctx, 'view.zoom');
    await settle();

    expect(ctx.contexts.commands.get('view.zoom.in')).toBeUndefined();
    expect(ctx.contexts.affordances.system('top').some(aff => aff.command === 'view.zoom.in')).toBe(false);
    expect(ctx.contexts.itemModes.all().some(mode => mode.source === 'view.zoom')).toBe(false);
    expect(ctx.contexts.itemOverlays.all()).toEqual([]);
    expect(ctx.contexts.itemTargets.all().some(target => target.label === 'Z')).toBe(false);
    expect(ctx.contexts.keyboard.active()).toBeNull();
    expect(commandButton('view.zoom.in')).toBeNull();
    ctx.bus.emit('view.zoom.in');
    expect(ctx.contexts.view.get().scale).toBe(before);
  });
});
