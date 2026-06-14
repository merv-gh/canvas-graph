// Ollama chat client with native tool-calling and a lenient text fallback.
// Normalized result: { kind: 'tool', name, args } | { kind: 'text', text }.

export const TOOL_SCHEMAS = [
  { name: 'read', description: 'Read a file (numbered lines).', parameters: { type: 'object', properties: { path: { type: 'string' }, from: { type: 'number', description: '1-based start line' }, lines: { type: 'number', description: 'max lines (default 60)' } }, required: ['path'] } },
  { name: 'search', description: 'Search file contents (regex), returns path:line hits.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, dir: { type: 'string', description: 'subdir, e.g. frontend/systems' } }, required: ['pattern'] } },
  { name: 'edit', description: 'Replace exact text once in a file. Send {"name":"edit","arguments":{"path":"..."}} followed by TWO fenced code blocks: first = exact OLD text, second = NEW text. (old/new may also be inline JSON args if you escape them properly.)', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path'] } },
  { name: 'write', description: 'Create or overwrite a whole file. Send {"name":"write","arguments":{"path":"..."}} followed by ONE fenced code block containing the entire file. (content may also be an inline JSON arg if properly escaped.)', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path'] } },
  { name: 'patch', description: 'Line-addressed edit using read\'s numbers — no old text needed. op=replace swaps `count` lines from `line`; op=insert_after inserts after `line`. JSON head, then new text in ONE fenced block.', parameters: { type: 'object', properties: { path: { type: 'string' }, op: { type: 'string', enum: ['replace', 'insert_after'] }, line: { type: 'number' }, count: { type: 'number' }, text: { type: 'string' } }, required: ['path', 'op', 'line'] } },
  { name: 'locate', description: 'Find an anchor under frontend/ and return verbatim numbered context, ready for patch line-numbers or edit copy.', parameters: { type: 'object', properties: { anchor: { type: 'string' }, dir: { type: 'string' } }, required: ['anchor'] } },
  { name: 'set_command', description: 'GREEN: add plain props to an EXISTING command by id. props is data, e.g. {"shortcut":"I","input":{"on":"keydown","key":"i","prevent":true}}. Best tool for shortcut/binding tasks.', parameters: { type: 'object', properties: { id: { type: 'string' }, props: { type: 'object' } }, required: ['id', 'props'] } },
  { name: 'add_command', description: 'GREEN: register a NEW command in a system + (optional) its handler. spec={id,label,group,shortcut?,input?,available?}. handler = JS body for on(event,(data)=>{...}). For new verbs (reverse/duplicate/export).', parameters: { type: 'object', properties: { system: { type: 'string', description: 'frontend/systems/*.ts file' }, spec: { type: 'object' }, handler: { type: 'string' } }, required: ['system', 'spec'] } },
  { name: 'add_command_alias', description: 'GREEN: add a hidden command id that forwards to an EXISTING event with a new shortcut. Use for Ctrl/Cmd variants, e.g. choose.all.cmd -> choose.all. Avoids creating a bogus new event.', parameters: { type: 'object', properties: { system: { type: 'string', description: 'frontend/systems/*.ts file' }, id: { type: 'string' }, event: { type: 'string', description: 'existing event to fire' }, key: { type: 'string' }, shortcut: { type: 'string' }, group: { type: 'string' }, ctrl: { type: 'boolean' }, shift: { type: 'boolean' }, alt: { type: 'boolean' }, meta: { type: 'boolean' } }, required: ['system', 'id', 'event', 'key'] } },
  { name: 'declare_event', description: 'GREEN: declare a new typed bus event in a system\'s CustomEvents (e.g. a new past-tense fact before you emit it).', parameters: { type: 'object', properties: { system: { type: 'string' }, event: { type: 'string' }, type: { type: 'string', description: 'TS payload type, default void' } }, required: ['system', 'event'] } },
  { name: 'add_css_rule', description: 'GREEN: add a CSS selector rule after a nearby existing selector. Safer than line patch for styling tasks. declarations may be an object or CSS text.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'CSS file, default frontend/styles.css' }, selector: { type: 'string' }, declarations: { type: 'object', description: 'CSS declarations, e.g. {"border-bottom":"1px dashed var(--line-strong)"}' }, after: { type: 'string', description: 'existing selector to insert after, optional' } }, required: ['selector', 'declarations'] } },
  { name: 'add_fold_toggle', description: 'GREEN: add a "collapse/fold a panel or region" command (left panel, top bar, event log, …). Wires the fold.toggle event + the {id:foldId} payload for you — supply only foldId+key. Optional surface adds a toolbar button. The panel-collapse task family.', parameters: { type: 'object', properties: { system: { type: 'string', description: 'frontend/systems/*.ts that renders the region' }, id: { type: 'string', description: 'new command id, e.g. view.left.toggle' }, foldId: { type: 'string', description: 'fold store id, e.g. outline.panel / shell.top' }, key: { type: 'string', description: 'keydown key, e.g. b' }, shortcut: { type: 'string' }, surface: { type: 'string', description: 'optional toolbar surface, e.g. top' }, glyph: { type: 'string' } }, required: ['system', 'id', 'foldId', 'key'] } },
  { name: 'add_fold_cancellable', description: 'GREEN: make Escape exit a folded region (zen mode, overlays). Registers a cancellable that un-folds foldId and ensures origin/contexts are destructured. Supply {system, foldId}.', parameters: { type: 'object', properties: { system: { type: 'string' }, foldId: { type: 'string', description: 'fold id to exit on Escape, e.g. shell.zen' } }, required: ['system', 'foldId'] } },
  { name: 'add_edge_reverse', description: 'GREEN: deterministically add graph.edge.reverse, including EdgePatch From/To typing, command spec, payload, and handler.', parameters: { type: 'object', properties: {} } },
  { name: 'add_graph_export_json', description: 'GREEN: deterministically add graph.export.json, graph.exported {json}, graph serialization, and guarded clipboard write.', parameters: { type: 'object', properties: {} } },
  { name: 'add_container_delete_cascade', description: 'GREEN: deterministically make graph.container.delete delete direct/nested child containers and child nodes through existing owner events.', parameters: { type: 'object', properties: {} } },
  { name: 'run_test', description: 'Run vitest. No path = full suite + typecheck.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'test file path (optional)' } } } },
  { name: 'app', description: 'Drive the live app. action=command: run a command id. action=snapshot: read state at dot-path (e.g. ui.shell). action=eval: run JS, window.app available. action=screenshot: capture + layout summary.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['command', 'snapshot', 'eval', 'screenshot'] }, arg: { type: 'string' } }, required: ['action'] } },
  { name: 'inspect', description: 'App map. what=commands (ids+shortcuts) | events (who fires/handles) | flows (one event\'s path, filter=event name).', parameters: { type: 'object', properties: { what: { type: 'string', enum: ['commands', 'events', 'flows'] }, filter: { type: 'string' } }, required: ['what'] } },
  { name: 'scenario', description: 'Boot app, run steps, check asserts — instant verification. spec={steps:[{command:"id"}|{event:"name",data:{}}],asserts:[{path:"ui.shell.zen",op:"eq",value:true}|{css:".node",op:"count",value:2}|{file:"frontend/styles.css",matches:"regex"}|{command:"id",has:"input.key",value:"i"}]}. ops: eq gt contains truthy falsy count. command-asserts check the command SPEC (shortcuts!).', parameters: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] } },
  { name: 'gen_test', description: 'RED only: a scenario spec whose asserts state DESIRED behavior → writes the red test file for you.', parameters: { type: 'object', properties: { title: { type: 'string' }, spec: { type: 'object' } }, required: ['title', 'spec'] } },
  { name: 'app_probe', description: 'LAYOUT tasks: measure REAL browser facts jsdom can\'t. spec={steps:[{command:"id"}|{event:"name",data:{}}],asserts:[{focus:".modal input"}|{rect:".node",op:"visible|hidden|count|in-viewport|width>|height>",value:2}|{style:".node-toggle",pseudo:"::before",prop:"content",op:"eq",value:"\\"▾\\""}|{path:"ui.modal.focusedField",op:"eq",value:"title"}]}. Read-only — use to find the failing layout/focus fact.', parameters: { type: 'object', properties: { spec: { type: 'object' } }, required: ['spec'] } },
  { name: 'gen_layout_test', description: 'RED only, LAYOUT tasks: an app_probe spec whose asserts state DESIRED behavior (failing now) → writes the .layout.json the loop runs through the browser oracle. The harness verifies it currently fails before saving.', parameters: { type: 'object', properties: { title: { type: 'string' }, spec: { type: 'object' } }, required: ['title', 'spec'] } },
  { name: 'graph', description: 'Code index → file:line. mode=find (keyword) | callers | callees | file (symbols in file) | tests (coverage of symbol).', parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['find', 'callers', 'callees', 'file', 'tests'] }, query: { type: 'string' } }, required: ['mode', 'query'] } },
  { name: 'projection', description: 'Compressed architecture view from the workspace. name=commands|events|command-ui|flows|data|render; filter narrows to an id/file/origin/entity/field. flows <origin> traces an event origin→handlers→⟳ render leaf (logic/render bugs); data <node|edge|container|item|graph> shows an entity lifecycle; render shows shell fold dataset/snapshot/CSS seams.', parameters: { type: 'object', properties: { name: { type: 'string', enum: ['commands', 'events', 'flows', 'command-ui', 'data', 'render'] }, filter: { type: 'string' } }, required: ['name'] } },
  { name: 'note', description: 'Save a short note to your persistent scratchpad (survives history trimming).', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'done', description: 'Declare the current phase goal achieved.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
  { name: 'give_up', description: 'Abandon the task with a reason.', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
];

const toOllamaTools = () => TOOL_SCHEMAS.map(t => ({ type: 'function', function: t }));

/** Tools offered for a walk: drive + observe + record only. Walk is
 *  reconnaissance, so withholding gen_test/write/run_test/constructors stops the
 *  model reaching for TDD muscle memory (it did, and looped to the turn cap). */
export const WALK_TOOLS = new Set(['app', 'inspect', 'note', 'done']);

/** One-line-per-tool docs for the prompt. First clause only — the loop
 *  re-injects full protocol detail on the specific failure, so the standing
 *  reminder stays cheap. Native-tool models still get the full schema.
 *  Filtered to WALK_TOOLS for the walk phase. */
export const toolDocsText = (phase) => TOOL_SCHEMAS
  .filter(t => phase !== 'walk' || WALK_TOOLS.has(t.name))
  .map(t => `${t.name}(${Object.keys(t.parameters.properties ?? {}).join(',')})`)
  .join(' ');

/** Single-string-arg tools that small models like to write as calls:
 *  give_up("reason") / done('summary') / note(text). */
const CALL_SYNTAX_ARG = { give_up: 'reason', done: 'summary', note: 'text' };

/** Models emit almost-JSON: raw newlines/tabs inside double-quoted strings, or
 *  whole values as backtick template literals (qwen-coder favorite). Walk the
 *  text tracking string state; escape control chars inside strings and convert
 *  backtick strings to proper JSON strings. Structural whitespace untouched. */
export function repairJson(raw) {
  let out = '', mode = 'plain', escaped = false; // plain | dquote | btick
  for (const ch of raw) {
    if (mode === 'dquote') {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { mode = 'plain'; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else if (mode === 'btick') {
      if (escaped) { out += ch === '`' ? '`' : `\\${ch}`; escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '`') { mode = 'plain'; out += '"'; continue; }
      if (ch === '"') { out += '\\"'; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') { mode = 'dquote'; out += ch; continue; }
      if (ch === '`') { mode = 'btick'; out += '"'; continue; }
      out += ch;
    }
  }
  return out;
}

/** Quote JavaScript-style bare object keys outside strings:
 *  {"input":{prevent:true}} -> {"input":{"prevent":true}}.
 *  This catches a common qwen shape without eval or a JS parser. */
export function quoteBareKeys(raw) {
  let out = '', mode = 'plain', escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (mode === 'dquote') {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') mode = 'plain';
      continue;
    }
    if (ch === '"') { mode = 'dquote'; out += ch; continue; }
    if (ch === '{' || ch === ',') {
      out += ch;
      i++;
      let ws = '';
      while (i < raw.length && /\s/.test(raw[i])) { ws += raw[i]; i++; }
      const rest = raw.slice(i);
      const m = rest.match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (m) {
        out += `${ws}"${m[1]}":`;
        i += m[0].length - 1;
      } else {
        out += ws;
        i--;
      }
      continue;
    }
    out += ch;
  }
  return out;
}

/** Lenient parse: find a tool call in free text. Accepts
 *  ```tool {...}``` / ```json {...}``` / bare {"name":...,"arguments":...} /
 *  name("single arg") call syntax for note/done/give_up. */
/** All fenced code blocks in the text, excluding ones that are tool-call JSON. */
export function fencedBlocks(text) {
  const blocks = [];
  const re = /```[a-zA-Z]*\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    if (/^\s*\{\s*"(name|tool|function)"/.test(body)) continue;
    blocks.push(body.replace(/\n$/, ''));
  }
  return blocks;
}

/** write/edit carry code in fenced blocks after the JSON head (JSON-escaped
 *  code from small models is hopeless — quotes inside code break the string). */
function attachFences(parsed, text) {
  if (parsed.name !== 'write' && parsed.name !== 'edit' && parsed.name !== 'patch') return parsed;
  const blocks = fencedBlocks(text);
  if (parsed.name === 'write' && parsed.args.content == null && blocks[0] != null) {
    parsed.args.content = blocks[0];
  }
  if (parsed.name === 'patch' && parsed.args.text == null && blocks[0] != null) {
    parsed.args.text = blocks[0];
  }
  if (parsed.name === 'edit') {
    if (parsed.args.old == null && blocks[0] != null) parsed.args.old = blocks[0];
    if (parsed.args.new == null && blocks[1] != null) parsed.args.new = blocks[1];
  }
  return parsed;
}

export function parseToolFromText(text) {
  const call = text.match(/^\s*(\w+)\(\s*["'`]?([\s\S]*?)["'`]?\s*\)\s*$/m);
  if (call && CALL_SYNTAX_ARG[call[1]]) {
    return { name: call[1], args: { [CALL_SYNTAX_ARG[call[1]]]: call[2] } };
  }
  // `name {args}` form (qwen favorite for note/app): a known tool name at line
  // start immediately before a JSON object. The name sits OUTSIDE the braces, so
  // the generic {"name":…,"arguments":…} path below can't find it. Try the object
  // span (longest first), repairing bare keys / control chars as usual.
  const nameWord = text.match(/^[ \t]*([A-Za-z_]\w*)[ \t]*\{/m);
  if (nameWord && TOOL_SCHEMAS.some(t => t.name === nameWord[1])) {
    const name = nameWord[1];
    const from = text.indexOf('{', nameWord.index);
    for (let end = text.length; (end = text.lastIndexOf('}', end - 1)) > from;) {
      const slice = text.slice(from, end + 1);
      for (const candidate of [slice, repairJson(slice), quoteBareKeys(repairJson(slice))]) {
        try {
          const args = JSON.parse(candidate);
          if (args && typeof args === 'object' && !Array.isArray(args)) {
            return attachFences({ name, args }, text);
          }
        } catch { /* next candidate */ }
      }
    }
  }
  const fence = text.match(/```(?:tool|json)?\s*\n?([\s\S]*?)```/);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const brace = text.indexOf('{');
  if (brace >= 0) candidates.push(text.slice(brace));
  const tryParse = (slice) => {
    const repaired = repairJson(slice);
    const jsEscapes = repaired.replace(/\\'/g, "'");
    for (const candidate of [slice, repaired, jsEscapes, quoteBareKeys(repaired), quoteBareKeys(jsEscapes)]) {
      try {
        const obj = JSON.parse(candidate);
        const name = obj.name ?? obj.tool ?? obj.function;
        const args = obj.arguments ?? obj.args ?? obj.parameters ?? obj.input ?? {};
        if (typeof name === 'string' && TOOL_SCHEMAS.some(t => t.name === name)) {
          return { name, args: typeof args === 'string' ? JSON.parse(args) : args };
        }
      } catch { /* next candidate */ }
    }
    return null;
  };
  for (const raw of candidates) {
    for (let end = raw.length; end > 1; end = raw.lastIndexOf('}', end - 1)) {
      const slice = raw.slice(0, raw.lastIndexOf('}', end) + 1);
      if (!slice) break;
      const hit = tryParse(slice);
      if (hit) return attachFences(hit, text);
    }
  }
  // Last resort: a write/edit whose JSON head is hopeless (unescaped quotes in
  // inline code) but whose path is readable and whose code sits in fences.
  const head = text.match(/"name"\s*:\s*"(write|edit)"[\s\S]*?"path"\s*:\s*"([^"]+)"/);
  if (head) return attachFences({ name: head[1], args: { path: head[2] } }, text);
  return null;
}

export class OllamaChat {
  constructor(cfg, log = () => {}) {
    this.cfg = cfg;
    this.log = log;
    this.nativeTools = true; // optimistic; flips off on the first "does not support tools" error
  }

  async chat({ model, messages, seed, temperature }) {
    const body = {
      model,
      messages,
      stream: false,
      options: {
        temperature: temperature ?? this.cfg.temperature,
        num_ctx: this.cfg.numCtx,
        num_predict: 4096, // write-tool payloads must never silently truncate
        ...(seed != null ? { seed } : {}),
      },
      ...(typeof this.cfg.think === 'boolean' ? { think: this.cfg.think } : {}),
    };
    if (this.nativeTools) body.tools = toOllamaTools();

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let res, json;
    try {
      res = await fetch(`${this.cfg.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      json = await res.json();
    } finally { clearTimeout(timer); }

    if (!res.ok || json.error) {
      const err = String(json?.error ?? `HTTP ${res.status}`);
      if (this.nativeTools && /does not support tools/i.test(err)) {
        this.log(`[ollama] ${model} has no native tools — switching to text protocol`);
        this.nativeTools = false;
        return this.chat({ model, messages, seed, temperature });
      }
      throw new Error(`ollama: ${err}`);
    }

    const msg = json.message ?? {};
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const evalTok = json.eval_count ?? '?', promptTok = json.prompt_eval_count ?? '?';
    this.log(`[ollama] ${model} ${secs}s prompt=${promptTok}tok out=${evalTok}tok`);

    const call = msg.tool_calls?.[0];
    if (call?.function?.name) {
      let args = call.function.arguments ?? {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      return { kind: 'tool', name: call.function.name, args, rawText: msg.content ?? '', raw: msg };
    }
    const text = msg.content ?? '';
    const parsed = parseToolFromText(text);
    if (parsed) return { kind: 'tool', name: parsed.name, args: parsed.args, rawText: text, raw: msg };
    return { kind: 'text', text, rawText: text, raw: msg };
  }
}
