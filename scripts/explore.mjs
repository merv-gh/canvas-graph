#!/usr/bin/env node
/**
 * v2 action explorer — exhaustive screenshot sweep.
 *
 * Boots v2 in a headless chromium, enumerates every auto-runnable command,
 * runs sequences (length-1 by default, length-2 with EXPLORE_DEPTH=2),
 * screenshots after each, then writes an HTML index you can open and scrub.
 *
 * Each card on the index shows:
 *   - the sequence (e.g. `editing.container.create → editing.node.create`)
 *   - the screenshot
 *   - quick stats (nodes / edges / containers / selected / DX errors)
 *   - pass/fail flag (red border if DX errored)
 *
 * Usage:
 *    npm run dev:v2        # in another terminal, leave running
 *    npm run explore       # boots chromium, sweeps, opens nothing
 *    open tests/explore-out/index.html
 *
 *    EXPLORE_DEPTH=2 npm run explore   # also do every length-2 pair
 *    URL=http://127.0.0.1:5174/ npm run explore
 *
 * Adding a new entity / system / ability automatically expands the sweep —
 * the enumerator reads commands.all() at boot, no manual list to maintain.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const baseURL = process.env.URL ?? 'http://127.0.0.1:5174/';
const depth = Math.max(1, Math.min(3, Number(process.env.EXPLORE_DEPTH ?? '1')));
const out = resolve(process.cwd(), 'tests/explore-out');

// Fresh output.
try { rmSync(out, { recursive: true, force: true }); } catch {}
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
page.on('pageerror', err => console.error('[page]', err.message));

const goto = async () => {
  await page.goto(baseURL);
  await page.waitForFunction(() => !!window.v2);
};

await goto();

const commands = await page.evaluate(() =>
  window.v2.contexts.commands.all()
    .filter(c => !c.hidden && !c.form && !c.picker && c.available?.() !== false)
    .map(c => ({ id: c.id, label: c.label, group: c.group ?? '' }))
);

console.log(`Enumerated ${commands.length} auto-runnable commands. Depth=${depth}.`);

const items = [];

const runSequence = async (seq) => {
  await goto();
  for (const id of seq) {
    await page.evaluate(c => { try { window.v2.contexts.commands.run(c); } catch (e) { window.__lastError = String(e); } }, id);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(120);
  const file = seq.map(s => s.replace(/[^a-z0-9]+/gi, '_')).join('__') + '.png';
  await page.screenshot({ path: `${out}/${file}` });
  const snap = await page.evaluate(() => {
    const v = window.v2;
    return {
      nodes: v.graphs.current.nodes().length,
      edges: v.graphs.current.edges().length,
      containers: (v.graphs.current.itemsOfKind('container') ?? []).length,
      selected: v.selection.selected(),
      focused: v.selection.focused(),
      scale: Math.round((v.contexts.view.get().scale ?? 1) * 100) / 100,
      dxErrors: (v.dx?.run() ?? []).filter(i => i.level === 'error').length,
      lastError: window.__lastError ?? null,
    };
  });
  items.push({ sequence: seq, file, snap });
};

const enumerate = (n) => {
  if (n === 0) return [[]];
  const tails = enumerate(n - 1);
  return [...tails, ...commands.flatMap(c => tails.map(t => [c.id, ...t]))];
};
const sequences = enumerate(depth).filter(s => s.length > 0);
console.log(`Running ${sequences.length} sequences…`);

let i = 0;
for (const seq of sequences) {
  await runSequence(seq);
  i++;
  if (i % 25 === 0) console.log(`  ${i}/${sequences.length}`);
}

writeFileSync(`${out}/manifest.json`, JSON.stringify({ commands, items }, null, 2));

const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>v2 action explorer</title>
<style>
  :root { --bg:#fafaf9; --panel:#fff; --line:#e5e5e3; --ink:#1c1c1c; --muted:#6b7280; --ok:#059669; --bad:#dc2626; --accent:#2563eb; }
  * { box-sizing: border-box; }
  body { margin:0; background: var(--bg); color: var(--ink); font: 13px/1.4 system-ui, sans-serif; padding: 16px; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  .toolbar { display:flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  .toolbar input { padding: 6px 10px; font: inherit; border: 1px solid var(--line); border-radius: 6px; width: 280px; }
  .toolbar .count { color: var(--muted); margin-left: auto; font-family: ui-monospace, monospace; }
  .toolbar label { color: var(--muted); display:flex; align-items:center; gap: 6px; cursor: pointer; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; transition: box-shadow .15s; }
  .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.06); }
  .card.bad { border-color: var(--bad); }
  .card img { width: 100%; height: 180px; object-fit: cover; cursor: zoom-in; background: #f5f5f4; }
  .card .meta { padding: 8px 10px; font-size: 11px; }
  .card .seq { font-family: ui-monospace, monospace; font-weight: 600; word-break: break-all; line-height: 1.5; }
  .card .stat { color: var(--muted); font-family: ui-monospace, monospace; }
  .card .status { display: inline-block; padding: 1px 6px; border-radius: 3px; font: 600 10px ui-monospace, monospace; }
  .status.ok { color: var(--ok); }
  .status.bad { color: var(--bad); }
  /* zoomed-out overlay */
  #lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: none; align-items: center; justify-content: center; z-index: 10; cursor: zoom-out; }
  #lightbox.open { display: flex; }
  #lightbox img { max-width: 92%; max-height: 92%; box-shadow: 0 10px 50px rgba(0,0,0,.5); }
</style>
</head><body>
<h1>v2 action explorer</h1>
<div class="toolbar">
  <input id="q" placeholder="filter sequences…" autofocus />
  <label><input type="checkbox" id="failonly"> only failures</label>
  <span class="count" id="count"></span>
</div>
<div class="grid" id="grid"></div>
<div id="lightbox"><img id="lightboxImg" /></div>
<script>
const data = ${JSON.stringify(items)};
const grid = document.getElementById('grid');
const q = document.getElementById('q');
const failOnly = document.getElementById('failonly');
const count = document.getElementById('count');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');

function render() {
  const filter = q.value.toLowerCase();
  const fail = failOnly.checked;
  const filtered = data.filter(it => {
    if (fail && it.snap.dxErrors === 0) return false;
    if (!filter) return true;
    return it.sequence.join(' ').toLowerCase().includes(filter);
  });
  count.textContent = filtered.length + ' / ' + data.length;
  grid.innerHTML = filtered.map(it => {
    const ok = it.snap.dxErrors === 0;
    const sel = it.snap.selected;
    return [
      '<div class="card ', (ok ? '' : 'bad'), '">',
      '<img loading="lazy" src="', it.file, '" data-full="', it.file, '" />',
      '<div class="meta">',
      '<div class="seq">', it.sequence.join(' → '), '</div>',
      '<div class="stat"><span class="status ', (ok ? 'ok' : 'bad'), '">', (ok ? 'OK' : 'DX ERR ' + it.snap.dxErrors), '</span> · ',
        'n:', it.snap.nodes, ' e:', it.snap.edges, ' c:', it.snap.containers,
      '</div>',
      '<div class="stat">selected: ', (sel ? sel.kind + ':' + sel.id : '—'), '</div>',
      '</div>',
      '</div>',
    ].join('');
  }).join('');
}
q.oninput = render;
failOnly.onchange = render;
grid.addEventListener('click', e => {
  const img = e.target.closest('img');
  if (!img) return;
  lightboxImg.src = img.dataset.full;
  lightbox.classList.add('open');
});
lightbox.addEventListener('click', () => lightbox.classList.remove('open'));
render();
</script>
</body></html>`;
writeFileSync(`${out}/index.html`, html);

await browser.close();
console.log(`✓ Wrote ${items.length} sequences to ${out}/index.html`);
console.log(`  open ${out}/index.html`);
