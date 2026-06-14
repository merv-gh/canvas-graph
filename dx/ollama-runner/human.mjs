// dx/human.mjs — YOU are the model. A drop-in replacement for OllamaChat that
// reads the exact context the model gets, lets you edit the workspace files in your
// own editor, and invoke the same tools by hand. The eval question this answers:
// is the view/context enough to act, or does the harness over-steer / spoon-feed?
//
// Used by `node dx/ollama-runner/loop.mjs --task <id> --human` (or `npm run dx <id> --human`).
// The rest of the loop (dispatch, phase gates, run_test, verify) is unchanged — only
// the "what does the agent do next" decision moves from the model to you.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseToolFromText, TOOL_SCHEMAS } from './ollama.mjs';

const VERBS = [
  'run', 'next', 'done', 'give_up', 'read', 'projection', 'inspect', 'graph',
  'locate', 'scenario', 'app_probe', 'gen_test', 'gen_layout_test',
  ...TOOL_SCHEMAS.map(t => t.name), 'help', 'tools', 'ws', 'context',
];
const UNIQUE = [...new Set(VERBS)];
const rule = (ch = '─') => ch.repeat(72);

export class HumanChat {
  constructor({ wsDir, log = () => {} }) {
    this.wsDir = wsDir;
    this.log = log;
    this.turn = 0;
    this.lastContext = '';
    this.shownSystem = false;
    this.rl = createInterface({
      input: stdin,
      output: stdout,
      completer: (line) => {
        const first = line.split(/\s+/)[0];
        const hits = UNIQUE.filter(v => v.startsWith(first));
        return [hits.length ? hits : UNIQUE, first];
      },
    });
  }

  banner(messages) {
    if (this.shownSystem) return;
    const sys = messages.find(m => m.role === 'system')?.content ?? '';
    stdout.write(`\n${rule('═')}\n SYSTEM PROMPT — the whole context the model is told. Judge it: honest? compact? enough?\n${rule('═')}\n${sys}\n${rule('═')}\n`);
    stdout.write(` WORKSPACE — open this in your editor and change files directly:\n   ${this.wsDir}\n${rule('═')}\n`);
    this.shownSystem = true;
  }

  // Loop calls chat({ model, messages, ... }); we ignore everything but messages.
  async chat({ messages }) {
    this.turn++;
    this.banner(messages);
    const last = messages.at(-1)?.content ?? '';
    this.lastContext = last;
    stdout.write(`\n${rule()}\n TURN ${this.turn} — context the model just received:\n${rule()}\n${last}\n${rule()}\n`);
    stdout.write(this.cheatSheet());
    for (;;) {
      let line;
      try { line = (await this.rl.question('\nmodel» ')).trim(); }
      catch { return { kind: 'tool', name: 'give_up', args: { reason: 'human aborted' }, rawText: '' }; }
      if (!line) continue;
      const parsed = this.parse(line);
      if (parsed === 'reprompt') continue;
      if (parsed) return parsed;
      stdout.write(`(couldn't parse "${line}" — type 'help')\n`);
    }
  }

  cheatSheet() {
    return [
      'You are the model. Edit files in the workspace, then drive the SAME tools by hand:',
      '  run | next             → run_test (your task test; RED must fail, GREEN must pass)',
      '  done [summary]         → finish the phase    give_up [reason]',
      '  read <path> [from] [n]    projection <name> [filter]    inspect <commands|events|flows> [f]',
      '  graph <find|callers|callees|file|tests> <q>   locate <anchor>',
      '  scenario {json}   app_probe {json}   gen_test <title> {json}   gen_layout_test <title> {json}',
      "  help · tools · ws · context · or paste raw {\"name\":...,\"arguments\":{...}}",
    ].join('\n') + '\n';
  }

  json(s) {
    try { return JSON.parse(s); }
    catch (e) { stdout.write(`(bad JSON: ${e.message})\n`); return null; }
  }

  parse(line) {
    const verb = line.split(/\s+/)[0];
    const rest = line.slice(verb.length).trim();
    const words = rest ? rest.split(/\s+/) : [];
    const tool = (name, args = {}) => ({ kind: 'tool', name, args, rawText: line });

    if (verb === 'help' || verb === '?') { stdout.write(this.cheatSheet()); return 'reprompt'; }
    if (verb === 'tools') { stdout.write(UNIQUE.filter(v => !['help', 'tools', 'ws', 'context'].includes(v)).join('  ') + '\n'); return 'reprompt'; }
    if (verb === 'ws') { stdout.write(this.wsDir + '\n'); return 'reprompt'; }
    if (verb === 'context') { stdout.write(`${rule()}\n${this.lastContext}\n${rule()}\n`); return 'reprompt'; }

    if (verb === 'run' || verb === 'next' || verb === 't') return tool('run_test', {});
    if (verb === 'done') return tool('done', { summary: rest || 'done' });
    if (verb === 'give_up') return tool('give_up', { reason: rest || 'human gave up' });
    if (verb === 'read') return tool('read', { path: words[0], ...(words[1] ? { from: Number(words[1]) } : {}), ...(words[2] ? { lines: Number(words[2]) } : {}) });
    if (verb === 'projection') return tool('projection', { name: words[0], ...(words.slice(1).length ? { filter: words.slice(1).join(' ') } : {}) });
    if (verb === 'inspect') return tool('inspect', { what: words[0], ...(words.slice(1).length ? { filter: words.slice(1).join(' ') } : {}) });
    if (verb === 'graph') return tool('graph', { mode: words[0], query: words.slice(1).join(' ') });
    if (verb === 'locate') return tool('locate', { anchor: rest });
    if (verb === 'note') return tool('note', { text: rest });

    // verb {json}: scenario / app_probe wrap as {spec}; gen_* take a title then json.
    if (verb === 'scenario' || verb === 'app_probe') {
      const j = this.json(rest); return j ? tool(verb, { spec: j }) : null;
    }
    if (verb === 'gen_test' || verb === 'gen_layout_test') {
      const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
      const title = m ? m[1] : 'human';
      const j = this.json(m ? m[2] : rest); return j ? tool(verb, { title, spec: j }) : null;
    }
    // any other registered tool taking JSON args: `set_command {json}`, etc.
    if (rest.startsWith('{')) { const j = this.json(rest); return j ? tool(verb, j) : null; }
    // raw model-style JSON: {"name":"...","arguments":{...}}
    if (line.startsWith('{')) { const p = parseToolFromText(line); return p ? { kind: 'tool', name: p.name, args: p.args, rawText: line } : null; }
    return null;
  }

  close() { try { this.rl.close(); } catch { /* already closed */ } }
}
