import { collectCommands } from '../file-to-projection/commands.mjs';
import { collectCommandUi, collectCancellationRegistrations } from '../file-to-projection/command-ui.mjs';
import { collectShellFolds } from '../file-to-projection/render.mjs';
import { DATA_ENTITIES } from '../file-to-projection/data.mjs';
import { eventFlowData, renderFlowEvent } from '../file-to-projection/flows.mjs';

const CONCEPT_STOP = new Set(['the', 'and', 'for', 'via', 'not', 'does', 'done', 'with', 'from',
  'into', 'this', 'that', 'out', 'off', 'are', 'way', 'back', 'once', 'mode', 'only', 'has',
  'have', 'its', 'but', 'all', 'any', 'new', 'add', 'make', 'when', 'then', 'now', 'should',
  'would', 'could', 'item', 'items', 'app', 'still', 'leaving', 'hidden']);

function conceptWords(query) {
  const words = new Set(String(query || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(word => word.length > 2 && !CONCEPT_STOP.has(word)));
  if ([...words].some(word => ['collapse', 'collapsed', 'collapsible', 'fold', 'folded', 'hide', 'hidden'].includes(word))) {
    words.add('fold');
    words.add('folded');
    words.add('toggle');
  }
  if ([...words].some(word => ['escape', 'cancel', 'cancellable'].includes(word))) {
    words.add('cancel');
    words.add('cancellation');
  }
  return [...words];
}

export function renderConcept(query) {
  const words = conceptWords(query);
  if (!words.length) return 'concept: provide a phrase to search\n';
  const score = (text) => { const t = String(text || '').toLowerCase(); return words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0); };
  const data = eventFlowData();
  const lines = [`concept "${words.join(' ')}" — auto-gathered from the views:`, ''];

  const commands = collectCommands()
    .map(command => ({ command, s: score(`${command.id} ${command.text}`) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 6);
  if (commands.length) {
    lines.push('commands:');
    for (const { command } of commands) {
      const shortcut = command.text.match(/\bshortcut\s*:\s*['"]([^'"]+)/)?.[1];
      lines.push(`  ${command.id}${shortcut ? ` [${shortcut}]` : ''}  ${command.rel}:${command.line}`);
    }
    lines.push('');
  }

  const commandIds = new Set(commands.map(({ command }) => command.id));
  const affordances = collectCommandUi()
    .map(item => ({ item, s: commandIds.has(item.id) ? 2 : score(`${item.id} ${item.body}`) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  if (affordances.length) {
    lines.push('ui affordances:');
    for (const { item } of affordances) {
      const surface = item.body.match(/\bsurface\s*:\s*['"]([^'"]+)/)?.[1] ?? '?';
      lines.push(`  ${item.id} on ${surface}  ${item.rel}:${item.line}`);
    }
    lines.push('');
  }

  const renderFolds = collectShellFolds()
    .map(fold => ({ fold, s: score(`${fold.field} ${fold.foldId} ${fold.attr} ${fold.css}`) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  if (renderFolds.length) {
    lines.push('render seams:');
    for (const { fold } of renderFolds) {
      lines.push(`  ${fold.field}: ${fold.foldId} -> ${fold.attr}  main.ts:${fold.line}, snapshot.ts, styles.css`);
    }
    lines.push('');
  }

  const cancellationRegistrations = collectCancellationRegistrations()
    .map(item => ({ item, s: score(`${item.rel} ${item.body}`) }))
    .filter(entry => entry.s > 0 || words.some(word => ['escape', 'cancel', 'cancellation', 'cancellable'].includes(word)))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  if (cancellationRegistrations.length) {
    lines.push('cancellables (Escape/app.cancel handlers):');
    for (const { item } of cancellationRegistrations) {
      const active = item.body.match(/\bactive\s*:\s*([^,\n}]+)/)?.[1]?.trim();
      const cancel = item.body.match(/\bcancel\s*:\s*([^,\n}]+)/)?.[1]?.trim();
      lines.push(`  ${item.rel}:${item.line}${active ? ` active=${active}` : ''}${cancel ? ` cancel=${cancel}` : ''}`);
    }
    lines.push('');
  }

  const commandEvents = commands.map(({ command }) =>
    command.text.match(/\bevent\s*:\s*['"]([^'"]+)/)?.[1] ?? command.id);
  const wordEvents = [...new Set([...data.handlersByEvent.keys(), ...data.commandsByEvent.keys()])]
    .map(event => ({ event, s: score(event) }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(entry => entry.event);
  const origins = [...new Set([...commandEvents, ...wordEvents])]
    .filter(event => data.handlersByEvent.has(event))
    .slice(0, 2);
  if (origins.length) {
    lines.push('flow (origin → handlers → ⟳ render leaf):');
    for (const event of origins) renderFlowEvent(lines, data, event, 1, new Set());
    lines.push('');
  }

  const entity = DATA_ENTITIES.find(e => words.includes(e));
  if (entity) lines.push(`entity '${entity}' lifecycle: project show data ${entity}`);

  if (!commands.length && !origins.length && !entity) {
    return `concept "${words.join(' ')}": no command/flow match — discover with inspect or projection.\n`;
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
