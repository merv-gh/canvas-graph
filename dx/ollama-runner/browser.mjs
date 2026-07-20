// Playwright session against the workspace's vite server. Gives the model eyes:
// run commands in the live app, read snapshot subtrees, eval JS, screenshot.
// Screenshots are summarized as text for the model and saved as PNG for humans.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runLayoutProbe } from './layout-probe.mjs';

export class Browser {
  constructor(port, shotDir, log = () => {}) {
    this.url = `http://127.0.0.1:${port}/?io=memory`;
    this.shotDir = shotDir;
    this.log = log;
    this.browser = null;
    this.page = null;
    this.shotCount = 0;
    this.consoleTail = [];
  }

  async open() {
    this.browser = await chromium.launch({ headless: true });
    this.page = await this.browser.newPage({ viewport: { width: 1280, height: 800 } });
    this.page.on('console', m => {
      this.consoleTail.push(`[${m.type()}] ${m.text()}`.slice(0, 200));
      if (this.consoleTail.length > 40) this.consoleTail.shift();
    });
    await this.goto();
  }

  async goto() {
    await this.page.goto(this.url, { waitUntil: 'load' });
    await this.page.waitForFunction(() => !!window.app, undefined, { timeout: 8000 });
  }

  /** Reload to pick up HMR-independent edits; cheap and avoids stale state. */
  async fresh() {
    try { await this.goto(); } catch (e) { this.log(`[browser] reload failed: ${e.message}`); throw e; }
  }

  async setViewport(value) {
    const match = String(value ?? '').match(/^(\d+)x(\d+)$/i);
    if (!match) throw new Error('viewport must be WIDTHxHEIGHT, e.g. 390x844');
    const width = Number(match[1]), height = Number(match[2]);
    await this.page.setViewportSize({ width, height });
    await this.page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))));
    return `${width}x${height}`;
  }

  async runCommand(id) {
    return this.page.evaluate(async (cmdId) => {
      const ok = window.app.contexts.commands.run(cmdId, { origin: 'programmatic' });
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
      return { ran: ok, notice: window.__lastNotice ?? null };
    }, id);
  }

  async snapshot(path) {
    return this.page.evaluate((p) => {
      let node = window.app.debug.snapshot();
      if (p) for (const key of p.split('.')) {
        node = node?.[key];
        if (node === undefined) return `no such path: ${p}`;
      }
      return node;
    }, path ?? '');
  }

  async evalJs(js) {
    return this.page.evaluate(async (code) => {
      try {
        const fn = new Function('frontend', `return (async () => (${code}))()`);
        const value = await fn(window.app);
        return JSON.stringify(value)?.slice(0, 4000) ?? 'undefined';
      } catch (err) { return `eval error: ${err.message}`; }
    }, js);
  }

  /** PNG to disk + structured layout summary for the (text) model. */
  async screenshot(label = 'shot') {
    mkdirSync(this.shotDir, { recursive: true });
    const file = join(this.shotDir, `${String(++this.shotCount).padStart(2, '0')}-${label}.png`);
    await this.page.screenshot({ path: file });
    const summary = await this.page.evaluate(() => {
      const frontend = window.app;
      const r = (place) => {
        const el = frontend.contexts.places.el(place);
        if (!el) return 'missing';
        const b = el.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)},${Math.round(b.y)}`;
      };
      const ui = frontend.debug.snapshot().ui;
      const panels = [...document.querySelectorAll('.tool-panel[data-panel-id]')]
        .filter(el => getComputedStyle(el).display !== 'none')
        .map(el => ({ id: el.getAttribute('data-panel-id'), rect: el.getBoundingClientRect() }));
      const overlaps = [];
      for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i], b = panels[j];
        if (a.rect.left < b.rect.right && a.rect.right > b.rect.left
          && a.rect.top < b.rect.bottom && a.rect.bottom > b.rect.top) {
          overlaps.push(`${a.id}<->${b.id}`);
        }
      }
      return `places top=${r('top')} left=${r('left')} stage=${r('stage')} modal=${r('modal')} | rendered nodes=${ui.rendered.nodes} edges=${ui.rendered.edges} containers=${ui.rendered.containers} | shell leftFolded=${ui.shell.leftFolded} zen=${ui.shell.zen} | modalOpen=${ui.modal.open} | panelOverlaps=${overlaps.join(',') || 'none'}`;
    });
    this.log(`[browser] screenshot ${file}`);
    return { file, summary };
  }

  /**
   * Layout oracle: run {steps, asserts} against the REAL browser and return a
   * structured verdict. Mirrors the jsdom `scenario` shape so the model uses one
   * mental model, but adds the assert kinds jsdom can't observe — real focus,
   * geometry/visibility, and computed style (incl. ::before, how glyph icons render).
   *
   *   steps:   [{command:'item.properties.open'}, {input:'.properties input', value:'New title'}]
   *   asserts: [{focus:'.properties input'},                       // document.activeElement
   *             {rect:'.modal', op:'visible'},                     // getBoundingClientRect + display
   *             {rect:'.node', op:'count', value:2},
   *             {rect:'[data-panel-id="layout"]', op:'not-overlap', other:'[data-panel-id="zoom"]'},
   *             {style:'.collapse-toggle', pseudo:'::before', prop:'content', op:'eq', value:'"▾"'},
   *             {path:'ui.modal.focusedField', op:'eq', value:'title'}]  // real-browser snapshot
   */
  async probe(spec = {}) {
    return runLayoutProbe(this.page, spec);
  }

  consoleLogs() { return this.consoleTail.join('\n'); }

  async close() {
    try { await this.browser?.close(); } catch { /* already gone */ }
    this.browser = null; this.page = null;
  }
}
