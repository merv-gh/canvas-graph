// Context-pack builder. The curated part (system + task card + notes) must fit
// the configured token budget (default 1000). Tool results stream in addition,
// pre-trimmed and history-capped, so total request stays small for 8k-ctx models.

import { toolDocsText } from './ollama.mjs';

export const estTokens = (s) => Math.ceil((s ?? '').length / 3.6);

const SYSTEM_BASE = `You fix bugs in a TypeScript app using tools, strict TDD. One tool call per reply, nothing else.

PHASE RED: write ONE vitest test proving the bug. It must FAIL on current code. Files ONLY under tests/commands/walker/. Run it with run_test; when it fails for the right reason, call done. The existing suite being green proves nothing — the task card's bug is real and untested. Don't give up.
PHASE GREEN: edit ONLY under v2/ until your red test passes, then call done (harness runs the full suite after).

App facts:
- Typed event bus. Imperative names = requests (graph.node.create); past-tense = facts emitted by the data owner (graph.node.created). Facts trigger redraw automatically.
- Mutate items only via emit('item.update',{ref,patch}). Commands are data: contexts.commands.register([{id,label,group,shortcut,input:{on:'keydown',key,prevent:true}}]). Never document.querySelector in v2 systems; use contexts.places.el(place).
- Test pattern (vitest has NO globals here — these two imports are mandatory):
  import { describe, expect, it } from 'vitest';
  import { bootV2, runCommand, settle } from '../v2-testkit';
  it('x', async () => { const ctx = bootV2(); runCommand(ctx,'cmd.id'); await settle();
    expect(ctx.graphs.current.nodes()).toHaveLength(1); });
  Vitest matchers only — toHaveAttribute/toHaveClass do NOT exist.
- Inspect: ctx.debug.snapshot() = {graph,selection,view,fold,ui:{places,shell,rendered,stage,outline,modal}}. ctx.contexts.commands.get(id). CSS rules can be asserted by reading v2/styles.css text (see tests/commands/recorded/*.test.ts).

TOOLS:
{TOOL_DOCS}

Be terse. Read before editing. Small diffs win.`;

export function buildSystemPrompt() {
  return SYSTEM_BASE.replace('{TOOL_DOCS}', toolDocsText());
}

export function buildTaskCard(task, phase, extra = '') {
  const lines = [
    `TASK ${task.id} [phase: ${phase}] — ${task.title}`,
    task.prompt.trim(),
    task.files ? `Likely files: ${task.files}` : '',
    phase === 'red'
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
