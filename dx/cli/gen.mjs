// Plugin scaffolder — the "add a new system / feature / ability" task shape made
// one command instead of copy-an-exemplar + remember-to-wire-index + write-a-smoke.
// Mirrors frontend's house style exactly (see frontend/systems/jump.ts, frontend/abilities/nudgeable.ts,
// the registration-name conventions, and Principle 7's flag off→on smoke test).
//
//   node dx/cli/apptool.mjs gen system  tool-panels
//   node dx/cli/apptool.mjs gen feature autoFit
//   node dx/cli/apptool.mjs gen ability lockable
//
// Each scaffold is contract-complete: it compiles, boots DX-clean with its flag on
// AND off, and ships a smoke test — so the only work left is filling in the TODOs.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = new Set(['system', 'feature', 'ability']);

// --- name forms -------------------------------------------------------------
// "tool-panels" → Pascal ToolPanels · camel toolPanels · kebab tool-panels · dot tool.panels
const toPascal = (s) => s.replace(/(^|[-_.\s]+)([a-zA-Z])/g, (_, __, c) => c.toUpperCase());
const toCamel = (s) => { const p = toPascal(s); return p ? p[0].toLowerCase() + p.slice(1) : p; };
const toKebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_.\s]+/g, '-').toLowerCase();
const toDot = (s) => toKebab(s).replace(/-/g, '.');

const names = (raw) => {
  const Pascal = toPascal(raw), camel = toCamel(raw), kebab = toKebab(raw), dot = toDot(raw);
  return { Pascal, camel, kebab, dot, group: kebab.split('-')[0] };
};

// --- templates (read like the surrounding code) -----------------------------
const systemFile = (n) => `import type { Registry } from '../core';

/** ${n.Pascal} — TODO: one sentence. What this system owns (its data, commands,
 *  events, render contributions, teardown). Toggling it off must not break
 *  others (Principle 2). Open the file CLAUDE.md index and add a line for it. */
declare module '../types' {
  interface CustomEvents {
    '${n.dot}.run': void;
  }
}

export function register${n.Pascal}(system: Registry) {
  system('${n.dot}', ({ on, contexts, contribute }) => {
    // Every capability is a command (data) AND a UI affordance (Principle 3).
    contexts.commands.register([
      {
        id: '${n.dot}.run',
        label: '${n.Pascal}',
        group: '${n.group}',
        // TODO: bind a key — input: { on: 'keydown', key: '?', prevent: true } — or leave palette-only.
      },
    ]);
    contribute({ surface: 'top', command: '${n.dot}.run', kind: 'button', text: '${n.Pascal}', order: 90 });
    on('${n.dot}.run', () => {
      // TODO: do the thing. Mutate domain state only via emit('item.update', …)
      // or a request event the owning system handles (Principle 21).
    });
  }, { requires: ['render'] });
}
`;

const abilityFile = (n) => `import type { Registry } from '../core';
import { ability, action } from './shared';
import type { Identified } from './shapes';

/** A command's id IS its default event, so it must be declared on the typed bus
 *  (same as configurable's \`item.properties.open\`). Carry the target ItemRef
 *  when you fill in payload/handler. */
declare module '../types' {
  interface CustomEvents {
    'item.${n.camel}': void;
  }
}

/** ${n.Pascal} — TODO: one capability an entity opts into. Both halves live here
 *  so toggling \`ability.${n.camel}\` removes UI + behavior atomically. An entity
 *  activates it by adding \`${n.camel}()\` to its \`abilities: [...]\` (model/entities.ts). */
export const ${n.camel} = <T extends Identified>() => ability<T>('${n.camel}', [action<T>({
  id: 'item.${n.camel}',
  label: '${n.Pascal}',
  paletteCommand: 'item.${n.camel}',
  ui: [{ surface: 'entity', command: 'item.${n.camel}', kind: 'button', text: '◆', label: '${n.Pascal}' }],
})]);

export function register${n.Pascal}(system: Registry) {
  system('ability.${n.camel}', ({ on, contexts, selection }) => {
    contexts.commands.register([{
      id: 'item.${n.camel}',
      label: '${n.Pascal}',
      group: 'item',
      available: () => !!selection.selected(),
      // TODO: payload: () => selection.selected(),
    }]);
    on('item.${n.camel}', () => {
      // TODO: act on the selected item via emit('item.update', { ref, patch }).
    });
  }, { requires: ['ability.selectable'] });
}
`;

const featureBlock = (n) => `  feature('${n.camel}', () => {
    // TODO: cross-system orchestration only — a fact in one domain triggers a
    // request in another. Destructure { on, emit } from the ctx arg, e.g.
    //   on('graph.node.created', ({ id }) => emit('view.fit.item', { kind: 'node', id }));
    // If it's just "X happened → redraw", delete this — render already does it.
  });
`;

const smokeTest = (n, { flag, cmdId }) => `import { describe, expect, it } from 'vitest';
import { bootApp, settle } from './testkit';

// Principle 7: a new plugin ships with a flag off→on smoke test.
describe('${n.kebab} ${flag.startsWith('ability.') ? 'ability' : cmdId ? 'system' : 'feature'}', () => {
  const errors = (ctx: ReturnType<typeof bootApp>) =>
    (ctx.dx?.run() ?? []).filter(i => i.level === 'error');

  it('boots DX-clean with the plugin on and off', async () => {
    const on = bootApp();
    await settle();
    expect(errors(on), 'errors on boot').toEqual([]);
${cmdId ? `    expect(on.contexts.commands.all().some(c => c.id === '${cmdId}'), '${cmdId} present when on').toBe(true);\n` : ''}
    const off = bootApp({ '${flag}': false });
    await settle();
    expect(errors(off), 'errors with the plugin off').toEqual([]);
${cmdId ? `    expect(off.contexts.commands.all().some(c => c.id === '${cmdId}'), '${cmdId} gone when off').toBe(false);\n` : ''}  });
});
`;

// --- wiring helpers ---------------------------------------------------------
const insertAfterLast = (lines, re, line) => {
  let at = -1;
  lines.forEach((l, i) => { if (re.test(l)) at = i; });
  if (at < 0) return false;
  lines.splice(at + 1, 0, line);
  return true;
};
const insertBeforeFirst = (lines, re, line) => {
  const at = lines.findIndex(l => re.test(l));
  if (at < 0) return false;
  lines.splice(at, 0, line);
  return true;
};

const editFile = (abs, fn) => {
  const lines = readFileSync(abs, 'utf8').split('\n');
  const ok = fn(lines);
  if (ok) writeFileSync(abs, lines.join('\n'));
  return ok;
};

// --- the generator ----------------------------------------------------------
export function genPlugin({ kind, name, repoRoot }) {
  if (!KINDS.has(kind)) return { error: `kind must be one of ${[...KINDS].join(' | ')}` };
  if (!name || !/^[a-zA-Z][\w-]*$/.test(name)) return { error: `bad name '${name}' — letters/digits/-/_ , starting with a letter` };
  const n = names(name);
  const written = [];
  const wired = [];
  const todo = [];
  const p = (...parts) => join(repoRoot, ...parts);

  if (kind === 'system') {
    const file = p('frontend/systems', `${n.kebab}.ts`);
    if (existsSync(file)) return { error: `already exists: frontend/systems/${n.kebab}.ts` };
    const idx = p('frontend/systems/index.ts');
    if (new RegExp(`register${n.Pascal}\\b`).test(readFileSync(idx, 'utf8'))) return { error: `register${n.Pascal} already wired in systems/index.ts` };
    writeFileSync(file, systemFile(n)); written.push(`frontend/systems/${n.kebab}.ts`);
    editFile(idx, ls => insertAfterLast(ls, /^import \{ register\w+ \} from '\.\//, `import { register${n.Pascal} } from './${n.kebab}';`)) && wired.push('systems/index.ts import');
    // Register before registerDx (the validator) so it stays last.
    editFile(idx, ls => insertBeforeFirst(ls, /^\s*registerDx\(system\);/, `  register${n.Pascal}(system);`)) && wired.push('systems/index.ts register call');
    addClaudeLine(p('frontend/systems/CLAUDE.md'), `- \`${n.kebab}.ts\` — TODO: one-line description of what ${n.Pascal} owns.`, /^Adding one:/) && wired.push('systems/CLAUDE.md');
    const test = p('tests/commands', `${n.kebab}.smoke.test.ts`);
    writeFileSync(test, smokeTest(n, { flag: n.dot, cmdId: `${n.dot}.run` })); written.push(`tests/commands/${n.kebab}.smoke.test.ts`);
  }

  if (kind === 'ability') {
    const file = p('frontend/abilities', `${n.kebab}.ts`);
    if (existsSync(file)) return { error: `already exists: frontend/abilities/${n.kebab}.ts` };
    const idx = p('frontend/abilities/index.ts');
    if (new RegExp(`register${n.Pascal}\\b`).test(readFileSync(idx, 'utf8'))) return { error: `register${n.Pascal} already wired in abilities/index.ts` };
    writeFileSync(file, abilityFile(n)); written.push(`frontend/abilities/${n.kebab}.ts`);
    editFile(idx, ls => insertAfterLast(ls, /^import \{ register\w+ \} from '\.\//, `import { register${n.Pascal} } from './${n.kebab}';`)) && wired.push('abilities/index.ts import');
    editFile(idx, ls => insertAfterLast(ls, /^export \{ \w+ \} from '\.\//, `export { ${n.camel} } from './${n.kebab}';`)) && wired.push('abilities/index.ts export');
    editFile(idx, ls => insertAfterLast(ls, /^\s*register\w+\(system\);/, `  register${n.Pascal}(system);`)) && wired.push('abilities/index.ts register call');
    addClaudeLine(p('frontend/abilities/CLAUDE.md'), `- \`${n.kebab}.ts\` — TODO: one-line description of the ${n.Pascal} capability.`, /^Mutations always go/) && wired.push('abilities/CLAUDE.md');
    const test = p('tests/commands', `${n.kebab}.smoke.test.ts`);
    writeFileSync(test, smokeTest(n, { flag: `ability.${n.camel}`, cmdId: `item.${n.camel}` })); written.push(`tests/commands/${n.kebab}.smoke.test.ts`);
    todo.push(`Activate it: add \`${n.camel}()\` to an entity's \`abilities: [...]\` in frontend/model/entities.ts (and mark its renderer's hook if the action needs one).`);
  }

  if (kind === 'feature') {
    const featuresPath = p('frontend/features.ts');
    const src = readFileSync(featuresPath, 'utf8');
    if (new RegExp(`feature\\('${n.camel}'`).test(src)) return { error: `feature '${n.camel}' already exists in features.ts` };
    const ok = editFile(featuresPath, ls => insertAfterLast(ls, /export function registerFeatures\(feature: Registry\) \{/, featureBlock(n).replace(/\n$/, '')));
    if (!ok) return { error: 'could not find registerFeatures(...) in frontend/features.ts' };
    wired.push('features.ts feature block');
    const test = p('tests/commands', `${n.kebab}.smoke.test.ts`);
    writeFileSync(test, smokeTest(n, { flag: n.camel, cmdId: '' })); written.push(`tests/commands/${n.kebab}.smoke.test.ts`);
  }

  return {
    kind,
    name: kind === 'feature' ? n.camel : kind === 'ability' ? `ability.${n.camel}` : n.dot,
    written,
    wired,
    nextSteps: [
      `Fill the TODOs in ${written[0]}.`,
      'Verify: npm run typecheck && npx vitest run -t "' + n.kebab + '"',
      ...todo,
    ],
  };
}

/** Insert a doc bullet just before a section marker; append at EOF if absent. */
function addClaudeLine(abs, line, marker) {
  if (!existsSync(abs)) return false;
  return editFile(abs, ls => {
    const at = ls.findIndex(l => marker.test(l));
    if (at < 0) { ls.push(line); return true; }
    // Walk back over the blank line(s) before the marker so the bullet joins the list.
    let i = at; while (i > 0 && ls[i - 1].trim() === '') i--;
    ls.splice(i, 0, line);
    return true;
  });
}
