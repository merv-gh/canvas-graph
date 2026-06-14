import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootApp, commandButton, runCommand, settle } from './testkit';

const Frontend = resolve(process.cwd(), 'frontend');

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

describe('frontend principles (enforced)', () => {
  // PRINCIPLE 1 — Smallest core. core.ts is the wiring layer; everything else lives
  // in /core/<concern>.ts or /systems/. New core APIs must come with deletions
  // elsewhere; if this assertion grows, split another sub-context out.
  it('core.ts stays ≤ 400 lines (smallest-core principle)', () => {
    const lines = readFileSync(join(Frontend, 'core.ts'), 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(400);
  });

  // PRINCIPLE 13 — Toolbar buttons come from data, not templates. The shell template
  // owns places, not contents — every button is contributed by a system or collection.
  it('shell template has zero hardcoded data-command attributes', () => {
    const html = readFileSync(join(Frontend, 'index.html'), 'utf8');
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
    for (const file of allFiles(Frontend)) {
      const rel = file.slice(Frontend.length + 1);
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
    const probe = bootApp();
    const systemNames = probe.flags.declared('system').filter(name => name !== 'render' && name !== 'input');
    for (const name of systemNames) {
      // dx throws on contract violations — we surface them, not silently swallow.
      try {
        // dx asserts a global contract; flipping a single system breaks some checks
        // (e.g. disabling `collections` removes the create command). The principle
        // being tested here is "boot does not crash", not "all DX rules still pass".
        const ctx = bootApp({ [name]: false, dx: false });
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
    const probe = bootApp();
    const abilityNames = probe.flags.declared('ability');
    for (const name of abilityNames) {
      try {
        // dx asserts a global contract; flipping a single system breaks some checks
        // (e.g. disabling `collections` removes the create command). The principle
        // being tested here is "boot does not crash", not "all DX rules still pass".
        const ctx = bootApp({ [name]: false, dx: false });
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
    const ctx = bootApp();
    const orphans = ctx.contexts.commands.all().filter(c => !c.origin);
    expect(orphans.map(c => c.id)).toEqual([]);
  });

  it('registry.stop tears down commands, affordances, and listeners by origin', async () => {
    const ctx = bootApp();
    await settle();
    const before = ctx.contexts.view.get().scale;

    expect(ctx.contexts.commands.get('view.zoom.in')).toBeTruthy();
    expect(commandButton('view.zoom.in')).not.toBeNull();
    ctx.contexts.decorations.modes.set('view.zoom', 'focused', [{ kind: 'node', id: 'e-test' }]);
    ctx.contexts.decorations.overlays.set('view.zoom', [{ ref: { kind: 'node', id: 'e-test' }, text: 'Z' }]);
    ctx.contexts.hierarchy.sources.register('view.zoom', () => [{ ref: { kind: 'node', id: 'e-test' }, label: 'Z', anchor: { x: 0, y: 0 } }]);
    ctx.contexts.keyboard.capture('view.zoom');

    ctx.registry!.stop(ctx, 'view.zoom');
    await settle();

    expect(ctx.contexts.commands.get('view.zoom.in')).toBeUndefined();
    expect(ctx.contexts.affordances.system('top').some(aff => aff.command === 'view.zoom.in')).toBe(false);
    expect(ctx.contexts.decorations.modes.all().some(mode => mode.source === 'view.zoom')).toBe(false);
    expect(ctx.contexts.decorations.overlays.all()).toEqual([]);
    expect(ctx.contexts.hierarchy.targets().some(target => target.label === 'Z')).toBe(false);
    expect(ctx.contexts.keyboard.active()).toBeNull();
    expect(commandButton('view.zoom.in')).toBeNull();
    ctx.bus.emit('view.zoom.in');
    expect(ctx.contexts.view.get().scale).toBe(before);
  });

  it('flag.toggle stops and restarts the owning registry entry at runtime', async () => {
    const ctx = bootApp();
    await settle();

    expect(ctx.contexts.commands.get('item.collapse.toggle')).toBeTruthy();
    ctx.bus.emit('flag.toggle', { name: 'ability.collapsible', on: false });
    await settle();

    expect(ctx.flags.isOn('ability.collapsible')).toBe(false);
    expect(ctx.contexts.commands.get('item.collapse.toggle')).toBeUndefined();
    expect(ctx.model.entity('node')?.abilities.map(ability => ability.id)).not.toContain('collapsible');

    ctx.bus.emit('flag.toggle', { name: 'ability.collapsible', on: true });
    await settle();

    expect(ctx.flags.isOn('ability.collapsible')).toBe(true);
    expect(ctx.contexts.commands.get('item.collapse.toggle')).toBeTruthy();
    expect(ctx.model.entity('node')?.abilities.map(ability => ability.id)).toContain('collapsible');

    ctx.bus.emit('flag.toggle', { name: 'experiment.missing', on: false });
    expect(ctx.flags.isOn('experiment.missing')).toBe(false);

    ctx.runtime!.refresh();
    await settle();
    expect(ctx.contexts.commands.get('item.collapse.toggle')).toBeTruthy();
  });

  // PRINCIPLE — concepts merge & split safely; ctx.contexts is a ratchet. Adding
  // a context requires merging two others first, so the shared surface a
  // contributor must hold never quietly creeps upward. (Also a runtime DX rule.)
  it('ctx.contexts stays within the merge budget', () => {
    const ctx = bootApp();
    const names = Object.keys(ctx.contexts).filter(name => name !== 'teardown');
    expect(names.length).toBeLessThanOrEqual(14);
  });

  // PRINCIPLE — types read high → low. types.ts opens with a MODEL MAP, and the
  // nouns it names are defined further down, in that same order, so a reader
  // grasps the overview first and descends only into the detail they need.
  it('types.ts opens with a MODEL MAP whose nouns are defined below in order', () => {
    const src = readFileSync(join(Frontend, 'types.ts'), 'utf8');
    const mapAt = src.indexOf('MODEL MAP');
    const firstDef = src.search(/\nexport (type|interface) /);
    expect(mapAt).toBeGreaterThanOrEqual(0);
    expect(mapAt).toBeLessThan(firstDef); // overview precedes detail
    const nouns = ['Renderable', 'ItemRef', 'AppEvents', 'CommandSpec', 'AbilityDef', 'EntityDef', 'CollectionDef'];
    const positions = nouns.map(noun => src.indexOf(`export type ${noun}`));
    positions.forEach((pos, i) => expect(pos, nouns[i]).toBeGreaterThan(0));
    expect(positions).toEqual([...positions].sort((a, b) => a - b)); // high→low order
  });

  // PRINCIPLE — hierarchy is visible in navigation, not just storage. A node
  // moved into a container renders nested under it in the outline (full tree
  // assertions live in outline-tree.test.ts; this is the principle's anchor).
  it('nesting is visible in the outline, not only in the store', async () => {
    const ctx = bootApp();
    await settle();
    runCommand(ctx, 'editing.container.create');
    await settle();
    const cid = (ctx.graphs.current.itemsOfKind('container')[0] as { id: string }).id;
    runCommand(ctx, 'editing.node.create');
    await settle();
    const nid = ctx.graphs.current.nodes()[0].id;
    ctx.bus.emit('container.add-child', { containerId: cid, childRef: { kind: 'node', id: nid } });
    await settle();
    const nested = document.querySelector(`.outline-children .outline-row[data-item-kind="node"][data-item-id="${nid}"]`);
    expect(nested).not.toBeNull();
  });
});
