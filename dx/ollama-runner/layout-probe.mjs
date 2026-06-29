// Shared layout/focus/style probe — the oracle's brain, used by both the live
// dx Browser session (dx/browser.mjs) and the committed Playwright spec
// (tests/dx-layout.spec.ts) so the loop and CI judge a layout fix identically.
//
// Mirrors the jsdom `scenario` {steps, asserts} shape, but evaluates the assert
// kinds jsdom can't observe against a REAL Playwright page:
//   focus  — document.activeElement must match (or be inside) a selector
//   rect   — getBoundingClientRect + display/visibility: visible|hidden|count|in-viewport|width>|height>
//   style  — getComputedStyle property, with optional `pseudo` (::before/::after)
//   path   — any debug.snapshot() dot-path, read in the real browser

/** Drive {steps} on `page` (commands + bus events), settling a frame between each. */
export async function runLayoutSteps(page, steps = []) {
  for (const step of steps) {
    if (step.command) {
      await page.evaluate(async (id) => {
        window.app.contexts.commands.run(id, { origin: 'programmatic' });
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
      }, step.command);
    } else if (step.event) {
      await page.evaluate(({ name, data }) => {
        const frontend = window.app;
        if (frontend.sim?.replay) frontend.sim.replay([{ name, data: data ?? null, at: 0 }]);
        else if (typeof frontend.emit === 'function') frontend.emit(name, data ?? undefined);
        else frontend.bus?.emit?.(name, data ?? undefined);
      }, { name: step.event, data: step.data ?? null });
    }
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))));
  }
}

/** Evaluate {asserts} against the current page state. Returns {pass, results:[{label,ok,actual}]}. */
export async function evaluateLayoutAsserts(page, asserts = []) {
  const results = await page.evaluate((asserts) => {
    const cmp = (actual, op, value) => {
      switch (op ?? 'eq') {
        case 'eq': return actual === value;
        case 'neq': return actual !== value;
        case 'gt': return Number(actual) > Number(value);
        case 'lt': return Number(actual) < Number(value);
        case 'gte': return Number(actual) >= Number(value);
        case 'truthy': return !!actual;
        case 'falsy': return !actual;
        case 'contains': return String(actual).includes(String(value));
        default: return actual === value;
      }
    };
    const describeEl = (el) => el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}` : 'none';
    const visible = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && b.width > 0 && b.height > 0;
    };
    return asserts.map((a) => {
      try {
        if (a.focus !== undefined) {
          const active = document.activeElement;
          const ok = !!active && active !== document.body && (active.matches?.(a.focus) || !!active.closest?.(a.focus));
          return { label: `focus ${a.focus}`, ok, actual: describeEl(active) };
        }
        if (a.rect !== undefined) {
          const els = [...document.querySelectorAll(a.rect)];
          if ((a.op ?? 'visible') === 'count') return { label: `rect ${a.rect} count`, ok: cmp(els.length, 'eq', a.value), actual: els.length };
          const el = els[0];
          const b = el?.getBoundingClientRect();
          if (a.op === 'visible') return { label: `rect ${a.rect} visible`, ok: visible(el), actual: el ? `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)},${Math.round(b.y)} vis=${visible(el)}` : 'missing' };
          if (a.op === 'hidden') return { label: `rect ${a.rect} hidden`, ok: !visible(el), actual: el ? `vis=${visible(el)}` : 'missing' };
          if (a.op === 'in-viewport') { const ok = !!b && b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth; return { label: `rect ${a.rect} in-viewport`, ok, actual: b ? `@${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} (vp ${innerWidth}x${innerHeight})` : 'missing' }; }
          const dim = a.op === 'height>' ? b?.height : b?.width;
          return { label: `rect ${a.rect} ${a.op} ${a.value}`, ok: cmp(dim, 'gt', a.value), actual: b ? `${Math.round(b.width)}x${Math.round(b.height)}` : 'missing' };
        }
        if (a.style !== undefined) {
          const el = document.querySelector(a.style);
          const actual = el ? getComputedStyle(el, a.pseudo ?? null)[a.prop] : 'missing';
          return { label: `style ${a.style}${a.pseudo ?? ''} ${a.prop}`, ok: !!el && cmp(actual, a.op, a.value), actual };
        }
        if (a.cssvar !== undefined) {
          const el = document.querySelector(a.cssvar);
          const actual = el ? getComputedStyle(el).getPropertyValue(a.prop).trim() : null;
          return { label: `cssvar ${a.cssvar} ${a.prop}`, ok: !!el && cmp(actual, a.op, a.value), actual };
        }
        if (a.path !== undefined) {
          let node = window.app.debug.snapshot();
          for (const key of a.path.split('.')) node = node?.[key];
          return { label: `path ${a.path} ${a.op ?? 'eq'} ${a.value}`, ok: cmp(node, a.op, a.value), actual: node };
        }
        return { label: JSON.stringify(a), ok: false, actual: 'unknown assert kind' };
      } catch (err) {
        return { label: JSON.stringify(a), ok: false, actual: `error: ${err.message}` };
      }
    });
  }, asserts);
  return { pass: results.every(r => r.ok), results };
}

/** Convenience: run steps then asserts on a page already navigated to the app. */
export async function runLayoutProbe(page, { steps = [], asserts = [] } = {}) {
  await runLayoutSteps(page, steps);
  return evaluateLayoutAsserts(page, asserts);
}
