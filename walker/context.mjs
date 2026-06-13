// Context-pack builder. The curated part (system + task card + notes) must fit
// the configured token budget (default 1000). Tool results stream in addition,
// pre-trimmed and history-capped, so total request stays small for 8k-ctx models.

import { toolDocsText } from './ollama.mjs';

export const estTokens = (s) => Math.ceil((s ?? '').length / 3.6);

const SYSTEM_BASE = `You fix bugs in a TypeScript app using tools, strict TDD. ONE tool call per reply, nothing else.

RED → make ONE failing test: scenario {steps,asserts} with asserts stating DESIRED behavior (fail now) → gen_test writes it → run_test shows FAIL → the harness moves you to GREEN automatically. Write only under tests/commands/walker/. The suite being green proves nothing; the card's bug is real — don't give up.
GREEN → change ONLY v2/ until the test passes. Pick the edit tool by intent:
  • command-spec task → projection {name:"commands",filter:id} first
  • add shortcut/binding/group to an EXISTING command → set_command {id, props}; redundant existing props are OK
  • add a NEW command/verb → add_command {system, spec, handler?}
  • add a CSS selector rule → add_css_rule {selector, declarations, after?}
  • collapse/fold a panel or region (left panel, top bar, event log, zen) → add_fold_toggle {system, id, foldId, key, shortcut?, surface?}
  • make Escape exit a folded region (zen/overlay) → add_fold_cancellable {system, foldId}
  • reverse selected edge feature → add_edge_reverse {}
  • other CSS/code → patch {path, op:"replace"|"insert_after", line, count, text}  (line numbers from read/locate; never retype old text)
Re-check with scenario, confirm with run_test, then done.
DISCOVER first with projection (compressed source-owned views), inspect (commands/events/flows), and graph/locate (file:line) — not blind reads.

App facts:
- Typed event bus. Imperative = request (graph.node.create); past-tense = fact emitted by the owner after the change (graph.node.created); facts auto-redraw. Cross-system reactions live in v2/features.ts.
- Mutate items via emit('item.update',{ref,patch}). Commands are DATA: {id,label,group,shortcut,input:{on:'keydown',key,prevent:true},available,payload}. No document.querySelector in systems — use contexts.places.el(place).
- scenario asserts: graph.{nodes,edges,containers}, selection.count, ui.shell.{leftFolded,zen}, ui.rendered.{nodes,edges}, ui.modal.{open,focusedField}; command-spec; event-fired.

TOOLS (args in schema):
{TOOL_DOCS}

Terse. Discover, then one decisive edit.`;

export function buildSystemPrompt() {
  return SYSTEM_BASE.replace('{TOOL_DOCS}', toolDocsText());
}

export function buildTaskCard(task, phase, extra = '') {
  const lines = [
    `TASK ${task.id} [phase: ${phase}] — ${task.title}`,
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
