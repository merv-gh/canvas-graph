#!/usr/bin/env node
// Deterministic browser journeys, one terminal screenshot per
// journey, then a bounded visual-model verdict. This script never reads the dx
// task document and never edits product code. Suspicious, mechanically
// reproducible findings become candidate task + layout-test artifacts only.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { runLayoutProbe } from './ollama-runner/layout-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEFAULT_ENDPOINT = process.env.OLLAMA_ENDPOINT ?? 'http://192.168.1.148:11434';
const DEFAULT_MODEL = process.env.OLLAMA_VISION_MODEL ?? 'qwen2.5vl:7b';

const repeat = (step, count) => Array.from({ length: count }, () => ({ ...step }));

export const VIEWPORTS = [
  { width: 1440, height: 900, label: 'desktop-wide' },
  { width: 1280, height: 800, label: 'desktop' },
  { width: 1024, height: 768, label: 'laptop' },
  { width: 800, height: 900, label: 'narrow-desktop' },
  { width: 768, height: 1024, label: 'tablet-portrait' },
  { width: 844, height: 390, label: 'phone-landscape' },
  { width: 430, height: 932, label: 'phone-large' },
  { width: 390, height: 844, label: 'phone' },
  { width: 375, height: 812, label: 'phone-medium' },
  { width: 360, height: 800, label: 'phone-small' },
];

export const JOURNEYS = [
  {
    id: 'empty-orientation',
    purpose: 'Can a first-time user understand the empty canvas and its actions?',
    steps: [],
  },
  {
    id: 'vertical-chain',
    purpose: 'Read and navigate a moderately long vertical connected graph.',
    steps: [
      { command: 'layout.apply.vertical' },
      ...repeat({ command: 'editing.node.create' }, 9),
      { command: 'view.fit.all' },
    ],
  },
  {
    id: 'radial-branches',
    purpose: 'Create a hub with many branches and inspect radial readability.',
    steps: [
      { command: 'layout.apply.radial' },
      { command: 'editing.node.create' },
      ...repeat({ command: 'editing.node.create.keep' }, 8),
      { command: 'view.fit.all' },
    ],
  },
  {
    id: 'horizontal-chain',
    purpose: 'Read a wide connected sequence without losing controls or context.',
    steps: [
      { command: 'layout.apply.horizontal' },
      ...repeat({ command: 'editing.node.create' }, 11),
      { command: 'view.fit.all' },
    ],
  },
  {
    id: 'containers-and-tree',
    purpose: 'Understand containers alongside a tree of graph nodes.',
    steps: [
      { command: 'editing.container.create' },
      { command: 'editing.container.create' },
      ...repeat({ command: 'editing.node.create' }, 7),
      { command: 'layout.apply.tree' },
      { command: 'view.fit.all' },
    ],
  },
  {
    id: 'properties-long-title',
    purpose: 'Edit a realistic long node title in the item inspector.',
    steps: [
      ...repeat({ command: 'editing.node.create' }, 4),
      { command: 'item.properties.open' },
      { fill: '[data-item-modal-title]', value: 'Deployment pipeline with review and rollback' },
    ],
  },
  {
    id: 'palette-search',
    purpose: 'Find a layout action through the visible command palette UI.',
    steps: [
      ...repeat({ command: 'editing.node.create' }, 5),
      { click: '[data-command="palette.open"]' },
      { fill: '.palette-search', value: 'layout' },
    ],
  },
  {
    id: 'history-and-theme',
    purpose: 'Recover from edits, then switch theme through the visible toolbar.',
    steps: [
      ...repeat({ command: 'editing.node.create' }, 8),
      ...repeat({ command: 'history.undo' }, 3),
      ...repeat({ command: 'history.redo' }, 2),
      { click: '[data-command="theme.toggle"]' },
    ],
  },
  {
    id: 'presentation',
    purpose: 'Present a non-trivial tree with minimal distraction.',
    steps: [
      ...repeat({ command: 'editing.node.create' }, 12),
      { command: 'layout.apply.tree' },
      { command: 'view.fit.all' },
      { command: 'present.toggle' },
    ],
  },
  {
    id: 'dense-radial-zen',
    purpose: 'Focus on a dense map in zen mode while retaining a clear escape path.',
    steps: [
      { command: 'layout.apply.radial' },
      { command: 'editing.node.create' },
      ...repeat({ command: 'editing.node.create.keep' }, 11),
      { command: 'view.fit.all' },
      { command: 'view.zen' },
    ],
  },
];

export function buildWalks(count = 100) {
  const all = [];
  for (let journeyIndex = 0; journeyIndex < JOURNEYS.length; journeyIndex++) {
    for (let viewportIndex = 0; viewportIndex < VIEWPORTS.length; viewportIndex++) {
      const number = all.length + 1;
      all.push({
        number,
        id: `walk-${String(number).padStart(3, '0')}`,
        seed: 2000 + number * 97,
        journey: JOURNEYS[journeyIndex],
        viewport: VIEWPORTS[viewportIndex],
      });
    }
  }
  return all.slice(0, Math.max(0, Math.min(Number(count), all.length)));
}

function parseArgs(argv) {
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    walks: Number(opt('walks', '100')),
    batchSize: Number(opt('batch-size', '10')),
    out: resolve(opt('out', join(REPO, 'dx', 'journal', `visual-walks-${new Date().toISOString().replace(/[:.]/g, '-')}`))),
    endpoint: String(opt('endpoint', DEFAULT_ENDPOINT)).replace(/\/$/, ''),
    model: opt('model', DEFAULT_MODEL),
    mockVision: argv.includes('--mock-vision'),
  };
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function atomicText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, value);
  renameSync(temporary, path);
}

const settle = page => page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => setTimeout(resolveFrame, 35))));

export async function replaySteps(page, steps) {
  const outcomes = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const outcome = { index: index + 1, step, ok: true };
    try {
      if (step.command) {
        Object.assign(outcome, await page.evaluate(async id => {
          const commands = window.app.contexts.commands;
          const command = commands.get(id);
          const found = !!command;
          const enabled = found ? commands.isEnabled(command) : false;
          const available = found ? command.available?.({ origin: 'programmatic' }) !== false : false;
          const ran = found ? commands.run(id, { origin: 'programmatic' }) : false;
          await new Promise(resolveFrame => requestAnimationFrame(() => setTimeout(resolveFrame, 35)));
          return { found, enabled, available, ran, ok: !!ran };
        }, step.command));
      } else if (step.event) {
        await page.evaluate(({ name, data }) => {
          const app = window.app;
          if (app.sim?.replay) app.sim.replay([{ name, data: data ?? null, at: 0 }]);
          else if (typeof app.emit === 'function') app.emit(name, data ?? undefined);
          else app.bus?.emit?.(name, data ?? undefined);
        }, { name: step.event, data: step.data ?? null });
      } else if (step.click) {
        await page.locator(step.click).click({ timeout: 3000 });
      } else if (step.fill) {
        await page.locator(step.fill).fill(String(step.value ?? ''), { timeout: 3000 });
      } else if (step.type) {
        await page.locator(step.type).pressSequentially(String(step.value ?? ''), { delay: Number(step.delay ?? 0), timeout: 5000 });
      } else if (step.press) {
        await page.keyboard.press(String(step.press));
      } else if (step.focus) {
        await page.locator(step.focus).focus({ timeout: 3000 });
      }
      await settle(page);
    } catch (error) {
      outcome.ok = false;
      outcome.error = String(error.message).split('\n')[0].slice(0, 300);
    }
    outcomes.push(outcome);
  }
  await page.waitForTimeout(350);
  return outcomes;
}

export async function collectMechanicalFacts(page, consoleErrors = []) {
  const facts = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const selectorOf = element => {
      if (element.hasAttribute('data-panel-id')) return `.tool-panel[data-panel-id="${CSS.escape(element.getAttribute('data-panel-id'))}"]`;
      if (element.hasAttribute('data-command')) return `[data-command="${CSS.escape(element.getAttribute('data-command'))}"]`;
      if (element.id) return `#${CSS.escape(element.id)}`;
      const aria = element.getAttribute('aria-label');
      if (aria) return `${element.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
      const cls = [...element.classList].slice(0, 2).map(name => `.${CSS.escape(name)}`).join('');
      return cls || element.tagName.toLowerCase();
    };
    const rectValue = element => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const result = [];
    const modal = document.querySelector('[data-place="modal"] .modal-layer');
    const modalOpen = !!modal && visible(modal);
    const panels = [...document.querySelectorAll('.tool-panel[data-panel-id]')].filter(panel => visible(panel) && !modalOpen);
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i], b = panels[j];
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (width > 2 && height > 2) result.push({
        type: 'panel-overlap',
        severity: 'high',
        selectors: [selectorOf(a), selectorOf(b)],
        labels: [a.getAttribute('data-panel-id'), b.getAttribute('data-panel-id')],
        detail: `${Math.round(width)}x${Math.round(height)} px overlap`,
        rects: [rectValue(a), rectValue(b)],
      });
    }

    const controls = [...document.querySelectorAll('button,input,textarea,select,[role="button"]')]
      .filter(element => visible(element)
        && !element.matches('[data-item-kind][data-item-id]')
        && (!modalOpen || modal.contains(element)));
    const insideScrollableClip = element => {
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)
          && (parent.scrollHeight > parent.clientHeight + 2 || parent.scrollWidth > parent.clientWidth + 2)) return true;
      }
      return false;
    };
    const outside = [];
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) {
        if (insideScrollableClip(control)) continue;
        const selector = selectorOf(control);
        if (!outside.some(item => item.selector === selector)) outside.push({ selector, rect: rectValue(control) });
      }
    }
    outside.slice(0, 12).forEach(item => result.push({
      type: 'control-out-of-viewport', severity: 'high', selector: item.selector,
      detail: `control rect ${JSON.stringify(item.rect)} outside ${innerWidth}x${innerHeight}`,
    }));

    const controlOverlaps = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (width <= 2 || height <= 2) continue;
      const covered = width * height / Math.max(1, Math.min(ar.width * ar.height, br.width * br.height));
      if (covered < 0.1) continue;
      const selectors = [selectorOf(a), selectorOf(b)];
      if (selectors[0] === selectors[1]) continue;
      controlOverlaps.push({
        type: 'control-overlap', severity: 'high', selectors,
        labels: [a.getAttribute('aria-label') || a.textContent?.trim() || selectors[0], b.getAttribute('aria-label') || b.textContent?.trim() || selectors[1]].map(label => label.slice(0, 80)),
        detail: `${Math.round(width)}x${Math.round(height)} px overlap`,
        rects: [rectValue(a), rectValue(b)],
      });
    }
    result.push(...controlOverlaps.slice(0, 20));

    const nodes = [...document.querySelectorAll('.node[data-item-kind="node"][data-item-id]')].filter(visible);
    const nodeOverlaps = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
      const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (width <= 2 || height <= 2) continue;
      const idA = a.getAttribute('data-item-id'), idB = b.getAttribute('data-item-id');
      const labelOf = element => element.querySelector('[data-slot="title"], [data-editable-title]')?.textContent?.trim()
        || element.getAttribute('aria-label')?.split(';')[0] || element.getAttribute('data-item-id');
      nodeOverlaps.push({
        type: 'node-overlap', severity: 'high',
        selectors: [`.node[data-item-kind="node"][data-item-id="${CSS.escape(idA)}"]`, `.node[data-item-kind="node"][data-item-id="${CSS.escape(idB)}"]`],
        labels: [labelOf(a), labelOf(b)],
        detail: `${Math.round(width)}x${Math.round(height)} px node overlap`,
        rects: [rectValue(a), rectValue(b)],
      });
    }
    result.push(...nodeOverlaps.slice(0, 30));

    const containers = [...document.querySelectorAll('.container[data-item-kind="container"][data-item-id]')].filter(visible);
    const itemOverlaps = [];
    for (const container of containers) for (const node of nodes) {
      const ar = container.getBoundingClientRect(), br = node.getBoundingClientRect();
      const width = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
      const height = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
      if (width <= 2 || height <= 2) continue;
      const containerId = container.getAttribute('data-item-id'), nodeId = node.getAttribute('data-item-id');
      const containerLabel = container.querySelector('[data-slot="title"], [data-editable-title]')?.textContent?.trim()
        || container.getAttribute('aria-label')?.split(';')[0] || containerId;
      const nodeLabel = node.querySelector('[data-slot="title"], [data-editable-title]')?.textContent?.trim()
        || node.getAttribute('aria-label')?.split(';')[0] || nodeId;
      itemOverlaps.push({
        type: 'item-overlap', severity: 'high',
        selectors: [`.container[data-item-kind="container"][data-item-id="${CSS.escape(containerId)}"]`, `.node[data-item-kind="node"][data-item-id="${CSS.escape(nodeId)}"]`],
        labels: [containerLabel, nodeLabel],
        detail: `${Math.round(width)}x${Math.round(height)} px container/node overlap`,
        rects: [rectValue(container), rectValue(node)],
      });
    }
    result.push(...itemOverlaps.slice(0, 30));

    if (modalOpen) {
      const rect = modal.getBoundingClientRect();
      if (rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1) result.push({
        type: 'modal-out-of-viewport', severity: 'high', selector: selectorOf(modal),
        detail: `modal rect ${JSON.stringify(rectValue(modal))} outside ${innerWidth}x${innerHeight}`,
      });
    }

    if (document.documentElement.scrollWidth > innerWidth + 2) result.push({
      type: 'horizontal-overflow', severity: 'medium',
      detail: `document is ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px viewport`,
    });

    const clippedLabels = controls.filter(element => element.scrollWidth > element.clientWidth + 4)
      .slice(0, 8).map(element => selectorOf(element));
    if (clippedLabels.length) result.push({
      type: 'control-text-clipped', severity: 'medium', selectors: clippedLabels,
      detail: `${clippedLabels.length} visible control label(s) are clipped`,
    });

    const smallTargets = controls.filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.width < 32 || rect.height < 32;
    }).length;
    return {
      facts: result,
      summary: {
        viewport: { width: innerWidth, height: innerHeight },
        visibleControls: controls.length,
        smallTargets,
        visiblePanels: panels.map(panel => panel.getAttribute('data-panel-id')),
        modalOpen,
      },
      snapshot: window.app.debug.snapshot(),
    };
  });
  const errors = consoleErrors.slice(-12);
  if (errors.length) facts.facts.push({ type: 'console-error', severity: 'high', detail: errors.join(' | ') });
  return facts;
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    suspicious: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    category: { type: 'string' },
    summary: { type: 'string' },
    visibleEvidence: { type: 'array', items: { type: 'string' } },
    userImpact: { type: 'string' },
    replayStep: { type: 'integer' },
  },
  required: ['suspicious', 'confidence', 'category', 'summary', 'visibleEvidence', 'userImpact', 'replayStep'],
};

function visualPrompt(walk, outcomes) {
  return [
    'You are a strict visual UI/UX auditor. Inspect the attached terminal screenshot only.',
    'Question: is there a concrete visible usability defect (overlap, clipping, hidden/unreachable controls, unreadable content, broken hierarchy, or unusable spacing)?',
    'Do not report taste or hypothetical behavior. If pixels do not directly support an issue, set suspicious=false.',
    `Viewport: ${walk.viewport.width}x${walk.viewport.height} (${walk.viewport.label}).`,
    `User goal: ${walk.journey.purpose}`,
    `Exact deterministic replay: ${JSON.stringify(walk.journey.steps)}`,
    `Step outcomes: ${JSON.stringify(outcomes.map(item => ({ index: item.index, ok: item.ok, step: item.step, error: item.error })))}`,
    'Return one JSON object matching the provided schema. If several issues exist, report the clearest one.',
  ].join('\n');
}

function usageOf(payload) {
  const promptTokens = Number(payload.prompt_eval_count ?? 0);
  const outputTokens = Number(payload.eval_count ?? 0);
  return {
    calls: 1,
    promptTokens,
    outputTokens,
    totalTokens: promptTokens + outputTokens,
    modelSeconds: Number(((Number(payload.total_duration ?? 0)) / 1e9).toFixed(3)),
  };
}

export async function judgeScreenshot({ endpoint, model, walk, outcomes, screenshot, mockVision }) {
  if (mockVision) {
    return {
      verdict: { suspicious: false, confidence: 0, category: 'mock', summary: 'Mock visual verdict', visibleEvidence: [], userImpact: '', replayStep: 0 },
      usage: { calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, modelSeconds: 0 },
    };
  }
  const response = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: VERDICT_SCHEMA,
      keep_alive: '10m',
      options: { temperature: 0, num_ctx: 8192, num_predict: 384, seed: walk.seed },
      messages: [{
        role: 'user',
        content: visualPrompt(walk, outcomes),
        images: [readFileSync(screenshot).toString('base64')],
      }],
    }),
    signal: AbortSignal.timeout(360000),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(`vision model: ${payload.error ?? `HTTP ${response.status}`}`);
  const usage = usageOf(payload);
  try {
    const verdict = JSON.parse(payload.message?.content ?? '{}');
    return { verdict, usage };
  } catch (error) {
    return {
      verdict: { suspicious: false, confidence: 0, category: 'judge-error', summary: 'Visual verdict was not valid JSON', visibleEvidence: [], userImpact: '', replayStep: 0 },
      usage,
      judgeError: String(error.message),
    };
  }
}

function addUsage(total, next) {
  for (const key of ['calls', 'promptTokens', 'outputTokens', 'totalTokens', 'modelSeconds']) {
    total[key] = Number(((total[key] ?? 0) + (next?.[key] ?? 0)).toFixed(key === 'modelSeconds' ? 3 : 0));
  }
  return total;
}

export function aggregateUsage(records) {
  return records.reduce((total, record) => addUsage(total, record.usage), {
    calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, modelSeconds: 0,
  });
}

function factLabel(fact) {
  if (fact.type === 'panel-overlap' || fact.type === 'control-overlap' || fact.type === 'node-overlap' || fact.type === 'item-overlap') return `${fact.type}:${[...fact.selectors].sort().join('|')}`;
  if (fact.type === 'control-out-of-viewport' || fact.type === 'modal-out-of-viewport') return `${fact.type}:${fact.selector}`;
  return fact.type;
}

function reportLink(fromDir, path) {
  return relative(fromDir, path).split('\\').join('/');
}

export function batchMarkdown(batchNumber, records, outDir) {
  const batchDir = join(outDir, 'batches');
  const usage = aggregateUsage(records);
  const suspicious = records.filter(record => record.verdict?.suspicious);
  const lines = [
    `# Visual walk batch ${String(batchNumber).padStart(2, '0')}`,
    '',
    `Walks: ${records[0]?.walkId ?? '-'}–${records.at(-1)?.walkId ?? '-'} · suspicious: ${suspicious.length}/${records.length}`,
    `Vision usage: ${usage.promptTokens.toLocaleString()} prompt + ${usage.outputTokens.toLocaleString()} output = ${usage.totalTokens.toLocaleString()} tokens (${usage.calls} calls).`,
    '',
    '| walk | journey / viewport | verdict | mechanical evidence | end screenshot |',
    '|---|---|---|---|---|',
  ];
  for (const record of records) {
    const verdict = record.verdict ?? {};
    const visual = `${verdict.suspicious ? 'SUSPICIOUS' : 'clear'} ${(Number(verdict.confidence ?? 0) * 100).toFixed(0)}% — ${String(verdict.summary ?? '').replace(/\|/g, '\\|')}`;
    const mechanical = record.mechanical.facts.length
      ? record.mechanical.facts.map(fact => `${fact.type}: ${fact.detail}`).join('; ').replace(/\|/g, '\\|')
      : 'none';
    lines.push(`| ${record.walkId} | ${record.journey} · ${record.viewport.width}×${record.viewport.height} | ${visual} | ${mechanical} | [PNG](${reportLink(batchDir, record.screenshot)}) |`);
  }
  lines.push('', '## Suspicious details', '');
  if (!suspicious.length) lines.push('No screenshot in this batch was marked suspicious by the visual model.');
  for (const record of suspicious) {
    lines.push(
      `### ${record.walkId}: ${record.verdict.summary}`,
      '',
      `- Category: ${record.verdict.category}; confidence: ${record.verdict.confidence}`,
      `- Visible evidence: ${(record.verdict.visibleEvidence ?? []).join('; ') || 'none supplied'}`,
      `- User impact: ${record.verdict.userImpact || 'not supplied'}`,
      `- Exact replay: \`${JSON.stringify(record.steps)}\``,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}

function oracleFor(fact) {
  if (fact.type === 'panel-overlap' || fact.type === 'control-overlap' || fact.type === 'node-overlap' || fact.type === 'item-overlap') return { rect: fact.selectors[0], op: 'not-overlap', other: fact.selectors[1] };
  if (fact.type === 'control-out-of-viewport' || fact.type === 'modal-out-of-viewport') return { rect: fact.selector, op: 'in-viewport' };
  return null;
}

function verdictMatchesFact(verdict, fact) {
  const text = `${verdict?.category ?? ''} ${verdict?.summary ?? ''} ${(verdict?.visibleEvidence ?? []).join(' ')}`.toLowerCase();
  if (fact.type === 'panel-overlap' || fact.type === 'control-overlap' || fact.type === 'node-overlap' || fact.type === 'item-overlap') {
    if (!/overlap|obscur|cover|hidden behind/.test(text)) return false;
    const labels = fact.labels ?? fact.selectors?.map(selector => selector.match(/data-(?:panel-id|command)="([^"]+)/)?.[1] ?? '');
    const meaningful = labels.map(label => String(label).toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3))
      .filter(tokens => tokens.length);
    if (fact.type === 'item-overlap') return meaningful[0]?.some(token => text.includes(token)) ?? false;
    return meaningful.every(tokens => tokens.some(token => text.includes(token)));
  }
  if (fact.type === 'control-out-of-viewport' || fact.type === 'modal-out-of-viewport') {
    return /cut off|clipp|offscreen|out of (the )?viewport|outside|unreachable/.test(text);
  }
  return false;
}

function safeSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function candidateTitle(fact) {
  if (fact.type === 'panel-overlap') {
    const ids = fact.selectors.map(selector => selector.match(/data-panel-id="([^"]+)/)?.[1] ?? selector);
    return `${ids.join(' and ')} panels must not overlap`;
  }
  if (fact.type === 'control-overlap') {
    const commands = fact.selectors.map(selector => selector.match(/data-command="([^"]+)/)?.[1] ?? '');
    if (commands.some(command => command.startsWith('layout.apply.')) && commands.some(command => command.startsWith('view.zoom.'))) {
      return 'Layout and zoom controls must not overlap at compact widths';
    }
    return `${(fact.labels ?? fact.selectors).join(' and ')} controls must not overlap`;
  }
  if (fact.type === 'node-overlap') return `${(fact.labels ?? fact.selectors).join(' and ')} nodes must not overlap`;
  if (fact.type === 'item-overlap') return `${(fact.labels ?? fact.selectors).join(' and ')} must not overlap unless grouped`;
  return fact.detail;
}

export function promoteCandidates(records, outDir) {
  rmSync(join(outDir, 'candidates'), { recursive: true, force: true });
  const groups = new Map();
  for (const record of records) for (const fact of record.mechanical.facts) {
    const oracle = oracleFor(fact);
    if (!oracle) continue;
    const key = factLabel(fact);
    const group = groups.get(key) ?? { key, fact, hits: [] };
    if (!group.hits.some(hit => hit.walkId === record.walkId)) group.hits.push(record);
    groups.set(key, group);
  }
  const candidates = [];
  for (const group of groups.values()) {
    const visualHits = group.hits.filter(record => record.verdict?.suspicious && verdictMatchesFact(record.verdict, group.fact));
    const maxConfidence = Math.max(0, ...visualHits.map(record => Number(record.verdict?.confidence ?? 0)));
    if (!(visualHits.length && (group.hits.length >= 2 || maxConfidence >= 0.9))) continue;
    const representative = visualHits.sort((a, b) => Number(b.verdict.confidence) - Number(a.verdict.confidence))[0];
    const title = candidateTitle(group.fact);
    const slug = safeSlug(title);
    const dir = join(outDir, 'candidates', slug);
    const test = {
      title,
      viewport: representative.viewport,
      steps: representative.steps,
      asserts: [oracleFor(group.fact)],
    };
    const replay = {
      schema: 'recursive-mas/deterministic-visual-replay-v2',
      walkId: representative.walkId,
      journey: representative.journey,
      purpose: representative.purpose,
      seed: representative.seed,
      viewport: representative.viewport,
      steps: representative.steps,
      stepOutcomes: representative.stepOutcomes,
      screenshot: representative.screenshot,
      mechanicalFact: group.fact,
      visualVerdict: representative.verdict,
      corroboratingWalks: group.hits.map(hit => hit.walkId),
    };
    const task = [
      `# ${test.title}`,
      '',
      'Status: candidate — no product patch has been applied.',
      '',
      `User impact: ${representative.verdict.userImpact || group.fact.detail}`,
      '',
      '## Evidence',
      '',
      `- Visual verdict: ${representative.verdict.category}, confidence ${representative.verdict.confidence}; ${representative.verdict.summary}.`,
      `- Visible evidence: ${(representative.verdict.visibleEvidence ?? []).join('; ') || representative.verdict.summary}.`,
      `- Mechanical fact: ${group.fact.detail}.`,
      `- Reproduced by ${group.hits.length} deterministic walk(s): ${group.hits.map(hit => hit.walkId).join(', ')}.`,
      `- End-state evidence: [${representative.walkId}.png](../../screenshots/${representative.walkId}.png).`,
      '',
      '## Reproduction',
      '',
      `Viewport: ${representative.viewport.width}×${representative.viewport.height}`,
      '',
      '```json',
      JSON.stringify(representative.steps, null, 2),
      '```',
      '',
      '## Regression oracle',
      '',
      `The adjacent \`regression.layout.json\` replays the exact journey in Chromium and requires ${JSON.stringify(test.asserts[0])}.`,
      '',
    ].join('\n');
    atomicText(join(dir, 'TASK.md'), `${task}\n`);
    atomicJson(join(dir, 'replay.json'), replay);
    atomicJson(join(dir, 'regression.layout.json'), test);
    const selectors = group.fact.selectors ?? [];
    const commands = selectors.map(selector => selector.match(/data-command="([^"]+)/)?.[1] ?? '');
    const family = group.fact.type === 'node-overlap' ? 'graph-layout'
      : group.fact.type === 'item-overlap' ? 'container-layout'
        : (group.fact.type === 'panel-overlap'
          || (group.fact.type === 'control-overlap'
            && commands.some(command => command.startsWith('layout.apply.'))
            && commands.some(command => command.startsWith('view.zoom.')))) ? 'compact-chrome'
          : group.fact.type.includes('out-of-viewport') ? 'viewport' : 'other';
    candidates.push({ slug, title: test.title, hits: group.hits.length, visualHits: visualHits.length, representative: representative.walkId, dir, family });
  }
  candidates.sort((a, b) => (b.visualHits - a.visualHits) || (b.hits - a.hits) || a.title.localeCompare(b.title));
  const selected = [];
  for (const candidate of candidates) {
    if (candidate.family === 'other' || selected.some(item => item.family === candidate.family) || selected.length >= 3) {
      rmSync(candidate.dir, { recursive: true, force: true });
    } else selected.push(candidate);
  }
  return selected;
}

async function verifyCandidateTests(browser, baseUrl, candidates) {
  const admitted = [];
  for (const candidate of candidates) {
    const specPath = join(candidate.dir, 'regression.layout.json');
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    const page = await browser.newPage({ viewport: {
      width: Number(spec.viewport?.width ?? 1280),
      height: Number(spec.viewport?.height ?? 800),
    } });
    try {
      await page.context().addCookies([{ name: 'showDemo', value: 'false', url: baseUrl }]);
      await page.goto(`${baseUrl}/?io=memory`, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.app, undefined, { timeout: 8000 });
      const verdict = await runLayoutProbe(page, spec);
      const testResult = {
        schema: 'recursive-mas/layout-candidate-verification-v2',
        spec: specPath,
        expected: 'red',
        observed: verdict.pass ? 'green' : 'red',
        matchedExpectation: !verdict.pass,
        results: verdict.results,
      };
      const testResultPath = join(candidate.dir, 'test-result.json');
      atomicJson(testResultPath, testResult);
      candidate.verification = testResult.observed;
      candidate.testResult = testResultPath;
      const taskPath = join(candidate.dir, 'TASK.md');
      const task = readFileSync(taskPath, 'utf8').replace(
        'Status: candidate — no product patch has been applied.',
        `Status: candidate — no product patch has been applied.\n\nTest status: ${testResult.matchedExpectation ? 'verified RED on current code' : 'unexpectedly GREEN'}; see \`test-result.json\`.`,
      );
      atomicText(taskPath, task);
      if (testResult.matchedExpectation) admitted.push(candidate);
      else rmSync(candidate.dir, { recursive: true, force: true });
    } finally {
      await page.close();
    }
  }
  return admitted;
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolvePort(port));
    });
  });
}

async function startVite() {
  const port = await freePort();
  const process = spawn('npx', ['vite', 'frontend', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  process.stdout.on('data', chunk => { output += chunk; });
  process.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return { port, process };
    } catch { /* still starting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 200));
  }
  process.kill('SIGTERM');
  throw new Error(`vite failed to start: ${output.slice(-1000)}`);
}

async function stopProcess(process) {
  if (!process || process.exitCode != null) return;
  process.kill('SIGTERM');
  await new Promise(resolveWait => {
    const timer = setTimeout(() => { process.kill('SIGKILL'); resolveWait(); }, 2000);
    process.once('exit', () => { clearTimeout(timer); resolveWait(); });
  });
}

function walkResultPath(out, walk) {
  return join(out, 'walks', `${walk.id}.json`);
}

async function executeWalk({ browser, baseUrl, walk, out, endpoint, model, mockVision }) {
  const existingPath = walkResultPath(out, walk);
  let priorJudgment = null;
  let priorFailedUsage = null;
  let priorJudgeAttempts = 0;
  if (existsSync(existingPath)) {
    const existing = JSON.parse(readFileSync(existingPath, 'utf8'));
    const expectedModel = mockVision ? 'mock' : model;
    priorJudgeAttempts = Number(existing.judgeAttempts ?? (existing.usage?.calls ? 1 : 0));
    const reusable = existing.schema === 'recursive-mas/visual-walk-v2'
      && existing.model === expectedModel
      && !existing.judgeError
      && existing.verdict?.category !== 'judge-error'
      && existsSync(existing.screenshot);
    if (reusable && existing.measurementVersion === 3) return existing;
    if (reusable) priorJudgment = existing;
    else if (existing.model === expectedModel && existsSync(existing.screenshot) && priorJudgeAttempts >= 2) priorJudgment = existing;
    else if (existing.model === expectedModel && existing.usage) priorFailedUsage = existing.usage;
  }

  const page = await browser.newPage({ viewport: { width: walk.viewport.width, height: walk.viewport.height } });
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 400));
  });
  page.on('pageerror', error => consoleErrors.push(error.message.slice(0, 400)));
  try {
    if (walk.journey.id !== 'empty-orientation') {
      await page.context().addCookies([{ name: 'showDemo', value: 'false', url: baseUrl }]);
    }
    await page.goto(`${baseUrl}/?io=memory`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.app, undefined, { timeout: 8000 });
    const stepOutcomes = await replaySteps(page, walk.journey.steps);
    const screenshot = join(out, 'screenshots', `${walk.id}.png`);
    mkdirSync(dirname(screenshot), { recursive: true });
    await page.screenshot({ path: screenshot });
    const mechanical = await collectMechanicalFacts(page, consoleErrors);
    let judged;
    if (priorJudgment) {
      judged = { verdict: priorJudgment.verdict, usage: priorJudgment.usage, judgeError: priorJudgment.judgeError ?? null };
    } else {
      try {
        judged = await judgeScreenshot({ endpoint, model, walk, outcomes: stepOutcomes, screenshot, mockVision });
      } catch (error) {
        judged = {
          verdict: { suspicious: false, confidence: 0, category: 'judge-error', summary: 'Visual model call failed', visibleEvidence: [], userImpact: '', replayStep: 0 },
          usage: { calls: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, modelSeconds: 0 },
          judgeError: String(error.message),
        };
      }
    }
    if (priorFailedUsage) judged.usage = addUsage({ ...priorFailedUsage }, judged.usage);
    const record = {
      schema: 'recursive-mas/visual-walk-v2',
      measurementVersion: 3,
      walkId: walk.id,
      seed: walk.seed,
      journey: walk.journey.id,
      purpose: walk.journey.purpose,
      viewport: walk.viewport,
      steps: walk.journey.steps,
      stepOutcomes,
      screenshot,
      mechanical,
      model: mockVision ? 'mock' : model,
      judgeAttempts: priorJudgment ? priorJudgeAttempts : priorJudgeAttempts + 1,
      ...judged,
    };
    atomicJson(existingPath, record);
    return record;
  } finally {
    await page.close();
  }
}

function writeRunResult(config, records, candidates, status) {
  const usage = aggregateUsage(records);
  atomicJson(join(config.out, 'result.json'), {
    schema: 'recursive-mas/deterministic-visual-walks-v2',
    status,
    model: config.mockVision ? 'mock' : config.model,
    plannedWalks: config.walks,
    completedWalks: records.length,
    suspiciousWalks: records.filter(record => record.verdict?.suspicious).length,
    usage,
    candidates,
  });
}

function finalMarkdown(config, records, candidates) {
  const usage = aggregateUsage(records);
  const suspicious = records.filter(record => record.verdict?.suspicious);
  return [
    '# Deterministic visual walks — experiment v2',
    '',
    `Completed ${records.length}/${config.walks} seeded walks. The browser captured exactly one end-state screenshot per walk; no screenshot was manually inspected by the runner.`,
    '',
    `Visual model: ${config.mockVision ? 'mock' : config.model}. Usage: ${usage.promptTokens.toLocaleString()} prompt + ${usage.outputTokens.toLocaleString()} output = ${usage.totalTokens.toLocaleString()} tokens across ${usage.calls} calls.`,
    '',
    `Suspicious visual verdicts: ${suspicious.length}. Mechanically reproducible candidate tasks: ${candidates.length}.`,
    '',
    '## Batch reports',
    '',
    ...Array.from({ length: Math.ceil(records.length / config.batchSize) }, (_, index) => `- [Batch ${String(index + 1).padStart(2, '0')}](batches/batch-${String(index + 1).padStart(2, '0')}.md)`),
    '',
    '## Candidate tasks with browser tests',
    '',
    ...(candidates.length ? candidates.map(candidate => `- [${candidate.title}](candidates/${candidate.slug}/TASK.md) — ${candidate.hits} mechanical reproductions, ${candidate.visualHits} visual flags, [end-state evidence](screenshots/${candidate.representative}.png), browser test ${candidate.verification === 'red' ? 'verified RED' : candidate.verification}. No after image exists because discovery does not apply a product patch.`) : ['No finding met both the visual-evidence and mechanical-replay admission gates.']),
    '',
  ].join('\n');
}

async function unloadModel(endpoint, model) {
  try {
    await fetch(`${endpoint}/api/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(15000),
    });
  } catch { /* best effort */ }
}

export async function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  if (!Number.isInteger(config.walks) || config.walks < 1 || config.walks > 100) throw new Error('--walks must be 1..100');
  if (!Number.isInteger(config.batchSize) || config.batchSize < 1) throw new Error('--batch-size must be positive');
  mkdirSync(config.out, { recursive: true });
  const plan = buildWalks(config.walks);
  atomicJson(join(config.out, 'plan.json'), {
    schema: 'recursive-mas/deterministic-visual-plan-v2',
    generatedAt: new Date().toISOString(),
    strategy: 'commands/events for deterministic setup; real click/fill/type/press for user-facing interactions; one terminal screenshot',
    walks: plan.map(walk => ({ ...walk, journey: walk.journey.id, purpose: walk.journey.purpose, steps: walk.journey.steps })),
  });

  const records = [];
  let vite;
  let browser;
  try {
    vite = await startVite();
    browser = await chromium.launch({ headless: true });
    const baseUrl = `http://127.0.0.1:${vite.port}`;
    for (const walk of plan) {
      const record = await executeWalk({ browser, baseUrl, walk, out: config.out, endpoint: config.endpoint, model: config.model, mockVision: config.mockVision });
      records.push(record);
      writeRunResult(config, records, [], 'running');
      if (records.length % config.batchSize === 0 || records.length === plan.length) {
        const batchNumber = Math.ceil(records.length / config.batchSize);
        const from = (batchNumber - 1) * config.batchSize;
        const batch = records.slice(from, records.length);
        const batchPath = join(config.out, 'batches', `batch-${String(batchNumber).padStart(2, '0')}.md`);
        atomicText(batchPath, batchMarkdown(batchNumber, batch, config.out));
        atomicJson(batchPath.replace(/\.md$/, '.json'), {
          schema: 'recursive-mas/visual-batch-v2', batchNumber, usage: aggregateUsage(batch), walks: batch,
        });
        console.log(`[batch ${String(batchNumber).padStart(2, '0')}] ${batch.filter(item => item.verdict?.suspicious).length}/${batch.length} suspicious · ${batchPath}`);
      }
    }
    const candidates = await verifyCandidateTests(browser, baseUrl, promoteCandidates(records, config.out));
    writeRunResult(config, records, candidates, 'completed');
    atomicText(join(config.out, 'REPORT.md'), finalMarkdown(config, records, candidates));
    console.log(`[done] ${records.length} walks · ${candidates.length} candidate(s) · ${join(config.out, 'REPORT.md')}`);
  } finally {
    await browser?.close();
    await stopProcess(vite?.process);
    if (!config.mockVision) await unloadModel(config.endpoint, config.model);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
