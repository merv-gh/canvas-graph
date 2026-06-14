// Context-pack builder. The curated part (system + task card + notes) must fit
// the configured token budget (default 1000). Tool results stream in addition,
// pre-trimmed and history-capped, so total request stays small for 8k-ctx models.

import { toolDocsText } from './ollama.mjs';

export const estTokens = (s) => Math.ceil((s ?? '').length / 3.6);

const SYSTEM_BASE = `Fix a TypeScript graph app with tools and strict TDD. ONE tool call per reply.

RED → make ONE failing test: scenario desired behavior → gen_test → run_test FAIL. Write only tests/commands/walker/. The bug is real; don't give up.
GREEN → edit ONLY v2/. Pick by intent:
  • command spec → projection commands; event flow → projection flows; UI affordance → command-ui; event type → events
  • existing command props → set_command {id,props}; new command → add_command {system,spec,handler?}; CSS → add_css_rule
  • fold panel → add_fold_toggle; Escape exits fold → add_fold_cancellable
  • known mechanical tasks → add_edge_reverse / add_graph_export_json / add_container_delete_cascade
  • other code → patch with line numbers from read/locate
Re-check with scenario, confirm with run_test, then done. Discover with projection/inspect/graph/locate, not blind reads.

Facts: imperative events=requests, past-tense=owner facts, facts auto-redraw; cross-system reactions live in v2/features.ts. Commands are DATA. Mutate items via item.update. No document.querySelector in systems. Scenario asserts snapshot paths, command-spec, event-fired.

TOOLS (args in schema):
{TOOL_DOCS}

Terse. Discover, then one decisive edit.`;

export function buildSystemPrompt() {
  return SYSTEM_BASE.replace('{TOOL_DOCS}', toolDocsText());
}

export function buildTaskCard(task, phase, extra = '') {
  const lines = [
    `TASK ${task.id} [phase: ${phase}] — ${task.title}`,
    task.meta?.command ? `New command id: ${task.meta.command}` : '',
    task.meta?.event ? `Required event assert: ${task.meta.event}` : '',
    task.prompt.trim(),
    task.files ? `Likely files: ${task.files}` : '',
    task.kind === 'layout'
      ? (phase === 'red'
        ? `LAYOUT task — jsdom can't see this; use the browser oracle. RED: app_probe {steps,asserts} to find the broken focus/layout/style fact (asserts: focus / rect / style / path), then gen_layout_test {title,spec} with asserts stating the DESIRED behavior — it writes tests/commands/walker/${task.id}.layout.json once it confirms they fail. run_test to advance.`
        : `Make the layout oracle pass by editing v2/ only: run_test re-runs tests/commands/walker/${task.id}.layout.json in a REAL browser; app_probe to iterate cheaply.`)
      : phase === 'red'
        ? `Write the failing test at tests/commands/walker/${task.id}.test.ts then run_test it. import from '../v2-testkit'.`
        : `Make tests/commands/walker/${task.id}.test.ts pass by editing v2/ only.`,
    extra,
  ].filter(Boolean);
  return lines.join('\n');
}

/** Assemble messages: system + task(+notes) as first user msg + capped history. */
export function buildMessages({ system, taskCard, notes, history, budgets, log }) {
  const notesBlock = notes.length ? `\nYOUR NOTES:\n${notes.join('\n')}` : '';
  const staticPack = system + taskCard + notesBlock;
  const tokens = estTokens(staticPack);
  if (tokens > budgets.staticContextTokens) {
    log(`[context] WARN static pack ${tokens}tok > budget ${budgets.staticContextTokens}`);
  }
  const trimmedHistory = history.slice(-budgets.historyMessages);
  return {
    tokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: taskCard + notesBlock },
      ...trimmedHistory,
    ],
  };
}

export function trimResult(text, cap) {
  const s = String(text ?? '');
  if (s.length <= cap) return s;
  const head = s.slice(0, Math.floor(cap * 0.7));
  const tail = s.slice(-Math.floor(cap * 0.25));
  return `${head}\n…[trimmed ${s.length - cap} chars]…\n${tail}`;
}
