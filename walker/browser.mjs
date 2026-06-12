// Playwright session against the workspace's vite server. Gives the model eyes:
// run commands in the live app, read snapshot subtrees, eval JS, screenshot.
// Screenshots are summarized as text for the model and saved as PNG for humans.

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
    await this.page.waitForFunction(() => !!window.v2, undefined, { timeout: 8000 });
  }

  /** Reload to pick up HMR-independent edits; cheap and avoids stale state. */
  async fresh() {
    try { await this.goto(); } catch (e) { this.log(`[browser] reload failed: ${e.message}`); throw e; }
  }

  async runCommand(id) {
    return this.page.evaluate(async (cmdId) => {
      const ok = window.v2.contexts.commands.run(cmdId, { origin: 'programmatic' });
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
      return { ran: ok, notice: window.__lastNotice ?? null };
    }, id);
  }

  async snapshot(path) {
    return this.page.evaluate((p) => {
      let node = window.v2.debug.snapshot();
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
        const fn = new Function('v2', `return (async () => (${code}))()`);
        const value = await fn(window.v2);
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
      const v2 = window.v2;
      const r = (place) => {
        const el = v2.contexts.places.el(place);
        if (!el) return 'missing';
        const b = el.getBoundingClientRect();
        return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)},${Math.round(b.y)}`;
      };
      const ui = v2.debug.snapshot().ui;
      return `places top=${r('top')} left=${r('left')} stage=${r('stage')} modal=${r('modal')} | rendered nodes=${ui.rendered.nodes} edges=${ui.rendered.edges} containers=${ui.rendered.containers} | shell leftFolded=${ui.shell.leftFolded} zen=${ui.shell.zen} | modalOpen=${ui.modal.open}`;
    });
    this.log(`[browser] screenshot ${file}`);
    return { file, summary };
  }

  consoleLogs() { return this.consoleTail.join('\n'); }

  async close() {
    try { await this.browser?.close(); } catch { /* already gone */ }
    this.browser = null; this.page = null;
  }
}
