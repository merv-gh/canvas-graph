import { readFileSync } from 'node:fs';
import {
  FLOWS_VIEW,
  escapeRe,
  findMatching,
  lineNumber,
  listSourceFiles,
  rel,
  unique,
  writeProjection,
} from '../shared.mjs';
import { collectCommands } from './commands.mjs';
import { collectEventDecls } from './events.mjs';

export function collectEventUsages() {
  const usages = [];
  const callRe = /\b(on|emit|bus\.emit)\s*\(\s*(['"`])([^'"`]+)\2/g;
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (let m; (m = callRe.exec(source));) {
      usages.push({ kind: m[1] === 'bus.emit' ? 'emit' : m[1], event: m[3], file, rel: rel(file), line: lineNumber(source, m.index) });
    }
  }
  for (const command of collectCommands()) {
    const eventMatch = command.text.match(/\bevent\s*:\s*(['"`])([^'"`]+)\1/);
    usages.push({
      kind: 'command',
      event: eventMatch?.[2] ?? command.id,
      command: command.id,
      file: command.file,
      rel: command.rel,
      line: command.line,
    });
  }
  usages.sort((a, b) => a.event.localeCompare(b.event) || a.kind.localeCompare(b.kind) || a.rel.localeCompare(b.rel) || a.line - b.line);
  return usages;
}

function summarizeEmitCall(callText, event) {
  if (event === 'render.view.set' || event === 'render.view.clear') {
    const place = callText.match(/\bplace\s*:\s*([^,\n}]+)/)?.[1]?.trim();
    const key = callText.match(/\bkey\s*:\s*([^,\n}]+)/)?.[1]?.trim();
    const bits = [place ? `place: ${place}` : '', key ? `key: ${key}` : ''].filter(Boolean);
    if (bits.length) return `{${bits.join(', ')}}`;
  }
  if (event === 'fold.toggle' || event === 'fold.changed') {
    const id = callText.match(/\bid\s*:\s*([^,\n}]+)/)?.[1]?.trim();
    if (id) return `{id: ${id}}`;
  }
  return '';
}

function extractEmitInfos(text) {
  const emits = [];
  const re = /\b(?:emit|bus\.emit)\s*\(\s*(['"`])([^'"`]+)\1/g;
  for (let m; (m = re.exec(text));) {
    const open = text.indexOf('(', m.index);
    const close = open >= 0 ? findMatching(text, open, '(', ')') : -1;
    const callText = close >= 0 ? text.slice(m.index, close + 1) : m[0];
    emits.push({ event: m[2], detail: summarizeEmitCall(callText, m[2]) });
    if (close >= 0) re.lastIndex = close + 1;
  }
  if (/\bcontexts\.fold\.(?:toggle|set)\s*\(/.test(text)) emits.push({ event: 'fold.changed', detail: 'via contexts.fold' });
  const seen = new Set();
  return emits.filter(info => {
    const key = `${info.event}\0${info.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatEmitInfos(infos) {
  return infos.length
    ? infos.map(info => info.detail ? `${info.event} ${info.detail}` : info.event).join(', ')
    : '-';
}

function uniqueEmitInfos(infos) {
  const seen = new Set();
  return infos.filter(info => {
    const key = `${info.event}\0${info.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectLocalEmitters(source) {
  const locals = new Map();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/g;
  for (let m; (m = re.exec(source));) {
    let bodyStart = re.lastIndex;
    while (/\s/.test(source[bodyStart] ?? '')) bodyStart++;
    let body = '';
    if (source[bodyStart] === '{') {
      const close = findMatching(source, bodyStart, '{', '}');
      if (close < 0) continue;
      body = source.slice(bodyStart, close + 1);
      re.lastIndex = close + 1;
    } else {
      const directEmit = source.slice(bodyStart, bodyStart + 24).match(/^(?:emit|bus\.emit)\s*\(/);
      if (directEmit) {
        const open = source.indexOf('(', bodyStart);
        const close = open >= 0 ? findMatching(source, open, '(', ')') : -1;
        if (close < 0) continue;
        body = source.slice(bodyStart, close + 1);
        re.lastIndex = close + 1;
      } else {
        const end = source.indexOf(';', bodyStart);
        body = source.slice(bodyStart, end < 0 ? source.length : end);
        re.lastIndex = end < 0 ? source.length : end + 1;
      }
    }
    const emits = extractEmitInfos(body);
    if (emits.length) locals.set(m[1], emits);
  }
  return locals;
}

function expandLocalEmitInfos(handlerText, localEmitters) {
  const infos = [...extractEmitInfos(handlerText)];
  const directHandler = handlerText.match(/\bon\s*\(\s*(['"`])[^'"`]+\1\s*,\s*([A-Za-z_$][\w$]*)\s*\)$/)?.[2];
  for (const [name, emits] of localEmitters) {
    if (directHandler !== name && !new RegExp(`\\b${escapeRe(name)}\\s*\\(`).test(handlerText)) continue;
    infos.push(...emits.map(info => ({
      event: info.event,
      detail: info.detail ? `${info.detail} via ${name}()` : `via ${name}()`,
    })));
  }
  return uniqueEmitInfos(infos);
}

export function collectEventHandlers() {
  const handlers = [];
  const re = /\bon\s*\(\s*(['"`])([^'"`]+)\1/g;
  for (const file of listSourceFiles()) {
    const source = readFileSync(file, 'utf8');
    const localEmitters = collectLocalEmitters(source);
    for (let m; (m = re.exec(source));) {
      const open = source.indexOf('(', m.index);
      const close = findMatching(source, open, '(', ')');
      if (close < 0) continue;
      const text = source.slice(m.index, close + 1);
      const emitDetails = expandLocalEmitInfos(text, localEmitters);
      handlers.push({
        event: m[2],
        file,
        rel: rel(file),
        line: lineNumber(source, m.index),
        emitDetails,
        emits: unique(emitDetails.map(info => info.event)),
      });
      re.lastIndex = close + 1;
    }
  }
  handlers.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line || a.event.localeCompare(b.event));
  return handlers;
}

export function eventFlowData() {
  const declsByEvent = new Map();
  for (const decl of collectEventDecls()) {
    if (!declsByEvent.has(decl.id)) declsByEvent.set(decl.id, []);
    declsByEvent.get(decl.id).push(decl);
  }
  const commandsByEvent = new Map();
  for (const command of collectCommands()) {
    const event = command.text.match(/\bevent\s*:\s*(['"`])([^'"`]+)\1/)?.[2] ?? command.id;
    if (!commandsByEvent.has(event)) commandsByEvent.set(event, []);
    commandsByEvent.get(event).push(command);
  }
  const usagesByEvent = new Map();
  const emittedEvents = new Set();
  for (const usage of collectEventUsages()) {
    if (!usagesByEvent.has(usage.event)) usagesByEvent.set(usage.event, []);
    usagesByEvent.get(usage.event).push(usage);
    if (usage.kind === 'emit') emittedEvents.add(usage.event);
  }
  const handlersByEvent = new Map();
  for (const handler of collectEventHandlers()) {
    if (!handlersByEvent.has(handler.event)) handlersByEvent.set(handler.event, []);
    handlersByEvent.get(handler.event).push(handler);
  }
  const events = [...new Set([
    ...declsByEvent.keys(),
    ...commandsByEvent.keys(),
    ...usagesByEvent.keys(),
    ...handlersByEvent.keys(),
  ])].sort();
  return { declsByEvent, commandsByEvent, usagesByEvent, handlersByEvent, emittedEvents, events };
}

export function formatLoc(item) {
  return `${item.rel}:${item.line}`;
}

export const FACT_RE = /\.(created|updated|deleted|removed|changed|focused|selected|moved|added|committed|toggled|opened|closed|started|done|cancelled|cleared|set|applied|fit)$/;

const leafNote = (event) => FACT_RE.test(event)
  ? '  ⟳ fact → auto-redraw (UI leaf — render reads data here)'
  : '  ▪ terminal (no further handler)';

export function renderFlowEvent(lines, data, event, depth, seen) {
  const pad = '  '.repeat(depth);
  const handlers = data.handlersByEvent.get(event) ?? [];
  if (!handlers.length) {
    lines.push(`${pad}- ${event}${leafNote(event)}`);
    return;
  }
  lines.push(`${pad}- ${event}`);
  for (const handler of handlers) {
    const emits = formatEmitInfos(handler.emitDetails ?? handler.emits.map(event => ({ event, detail: '' })));
    lines.push(`${pad}  handler ${formatLoc(handler)} emits ${emits}`);
    for (const next of handler.emits.slice(0, 8)) {
      if (seen.has(next)) {
        lines.push(`${pad}    -> ${next} (cycle)`);
      } else if (depth >= 5) {
        lines.push(`${pad}    -> ${next} (depth limit)`);
      } else {
        renderFlowEvent(lines, data, next, depth + 2, new Set([...seen, event]));
      }
    }
    if (handler.emits.length > 8) lines.push(`${pad}    …${handler.emits.length - 8} more emitted events`);
  }
}

export function renderFlows() {
  const data = eventFlowData();
  const starts = data.events.filter(event =>
    data.commandsByEvent.has(event) ||
    event === 'app.start' ||
    (data.handlersByEvent.has(event) && !data.emittedEvents.has(event))
  );
  const lines = [
    '# @dx-projection flows frontend',
    '',
    'Read-only causal streams: origin event -> listeners in source order -> the events',
    'each listener emits, recursively, across files. See cross-system behaviour without',
    'opening every handler. Trace one origin: `project show flows <event|command-id>`.',
    'Leaf markers: `⟳ fact` = cascade reaches the UI (render reads data — a render bug',
    'lives here, logic bugs upstream); `▪ terminal` = dead-ends with no handler.',
    '',
  ];
  for (const event of starts) {
    lines.push(`## stream ${event}`);
    const commands = data.commandsByEvent.get(event) ?? [];
    if (commands.length) lines.push(`origin commands: ${commands.map(command => `${command.id} (${formatLoc(command)})`).join(', ')}`);
    renderFlowEvent(lines, data, event, 0, new Set());
    lines.push('');
  }

  lines.push('## event index', '');
  for (const event of data.events) {
    const decls = data.declsByEvent.get(event) ?? [];
    const usages = data.usagesByEvent.get(event) ?? [];
    const commands = usages.filter(u => u.kind === 'command');
    const emitters = usages.filter(u => u.kind === 'emit');
    const handlers = usages.filter(u => u.kind === 'on');
    lines.push(`### ${event}`);
    if (decls.length) lines.push(`declared: ${decls.map(d => `${d.rel}:${d.line}`).join(', ')}`);
    if (commands.length) lines.push(`commands: ${commands.map(u => `${u.command} (${u.rel}:${u.line})`).join(', ')}`);
    if (emitters.length) lines.push(`emitters: ${emitters.map(u => `${u.rel}:${u.line}`).join(', ')}`);
    if (handlers.length) lines.push(`handlers: ${handlers.map(u => `${u.rel}:${u.line}`).join(', ')}`);
    if (!decls.length) lines.push('declared: -');
    if (!commands.length && !emitters.length && !handlers.length) lines.push('usage: -');
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

export function generateFlows({ quiet = false } = {}) {
  const def = {
    name: 'flows',
    outFile: FLOWS_VIEW,
    render: renderFlows,
    count: () => collectEventUsages().length,
  };
  writeProjection(def, def.render(), quiet);
}
