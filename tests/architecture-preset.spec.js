const { test, expect, setup, paletteRun } = require('./browser-testkit.cjs');

/** Acceptance: recreate a Kimi-style architecture-diagram subset via the UI —
 *  once with the mouse, once fully keyboard-only (ink excluded from the
 *  keyboard flow: the stroke gesture is inherently pointer-based; its toggle /
 *  select / delete remain keyboard-reachable). */

const model = (page) => page.evaluate(() => {
  const g = window.app.graphs.current;
  return {
    preset: document.querySelector('.shell')?.getAttribute('data-preset') ?? null,
    nodes: g.nodes().map(node => ({ label: node.Label.text, type: node.NodeType, color: node.Color ?? null })),
    edges: g.edges().map(edge => ({ From: edge.From, To: edge.To, kind: edge.EdgeKind ?? null })),
    containers: g.itemsOfKind('container').map(container => ({
      label: container.Label.text,
      children: container.Children.length,
      legend: container.Legend ?? [],
      multiplier: container.Multiplier ?? null,
    })),
    ink: g.itemsOfKind('ink').map(stroke => ({ points: stroke.Points.length, color: stroke.Color })),
  };
});

test('mouse flow: preset, typed colored blocks, plain edge, dashed kind, ink annotation', async ({ page }) => {
  await setup.app(page);

  // Preset remains an internal demo/document mode; the universal node gallery
  // no longer exposes collection tabs.
  await page.evaluate(() => window.app.bus.emit('preset.set', { preset: 'architecture' }));
  await expect(page.locator('.shell[data-preset="architecture"]')).toHaveCount(1);

  // Add mode places the active catalog default (dense for this preset).
  await page.getByRole('button', { name: 'Add node', exact: true }).click();
  const placementStage = page.locator('[data-place="stage"]');
  const stageBox = await placementStage.boundingBox();
  await placementStage.click({ position: { x: stageBox.width - 160, y: stageBox.height - 180 } });
  await expect(page.locator('.node')).toHaveCount(2);
  const ids = await page.evaluate(() => window.app.graphs.current.nodes().map(node => node.id));

  // The graph drawer stays graph-only; node styles remain command-accessible.
  await paletteRun(page, 'Arm node type: ML · Attention');
  await paletteRun(page, 'Arm node color: Red');
  await expect(page.locator(`.node[data-item-id="${ids[1]}"].node-type-attention[data-node-color="red"]`)).toHaveCount(1);

  // Connect via the picker (click path); the preset defaults the kind to plain.
  await page.locator(`.node[data-item-id="${ids[0]}"]`).dispatchEvent('pointerdown', { bubbles: true, cancelable: true });
  await page.locator('.toolbar [data-command="editing.edge.create"]').click();
  await page.locator(`.node[data-item-id="${ids[1]}"]`).dispatchEvent('pointerdown', { bubbles: true, cancelable: true });
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.edges().length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.edges()[0].EdgeKind)).toBe('plain');
  const edgeId = await page.evaluate(() => window.app.graphs.current.edges()[0].id);
  await expect(page.locator(`.edge-line[data-item-id="${edgeId}"]`)).not.toHaveAttribute('marker-end', /.+/);

  // Switch the edge kind from the properties modal's direct choices.
  await page.getByRole('button', { name: 'Expand graph navigator', exact: true }).click();
  await page.locator(`.edge-hit[data-item-id="${edgeId}"]`).dispatchEvent('pointerdown', { bubbles: true, cancelable: true });
  await page.locator('[data-command="item.properties.open"]').first().click();
  await page.locator('.properties [data-field="edgeKind"][data-value="dashed"]').click();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.edges()[0].EdgeKind)).toBe('dashed');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-layer')).toHaveCount(0);

  // Free-form ink annotation: toggle draw mode, drag a stroke, exit.
  await page.locator('.tool-panel[data-panel-id="top"] [data-command="ink.toggle"]').click();
  await expect(page.locator('.stage.ink-drawing')).toHaveCount(1);
  const stage = page.locator('[data-place="stage"]');
  const box = await stage.boundingBox();
  const drawX = box.x + Math.max(420, box.width * 0.65);
  await page.mouse.move(drawX, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(drawX + 60, box.y + 180, { steps: 8 });
  await page.mouse.move(drawX + 120, box.y + 150, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.itemsOfKind('ink').length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.stage.ink-drawing')).toHaveCount(0);
  await expect(page.locator('.ink-path')).toHaveCount(1);

  const state = await model(page);
  expect(state.preset).toBe('architecture');
  expect(state.nodes.map(node => node.type).sort()).toEqual(['attention', 'dense']);
  expect(state.edges).toEqual([expect.objectContaining({ kind: 'dashed' })]);
  expect(state.ink).toEqual([expect.objectContaining({ color: 'pink' })]);
  expect(state.ink[0].points).toBeGreaterThan(2);
});

test('keyboard-only flow: preset, blocks, chain, edge kinds, grouping, legend, multiplier', async ({ page }) => {
  await setup.app(page);

  // Preset — palette opens the picker modal, Tab reaches the choice, Enter applies.
  await paletteRun(page, 'Choose collection');
  await expect(page.locator('[data-preset-choice="architecture"]')).toHaveCount(1);
  for (let i = 0; i < 12; i += 1) {
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-preset-choice'));
    if (focused === 'architecture') break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await expect(page.locator('.shell[data-preset="architecture"]')).toHaveCount(1);

  // Four blocks: `a` creates+selects, Enter edits the title, Enter commits.
  const labels = ['MLA attention', 'Expert router', 'Shared expert', 'Routed experts'];
  for (let i = 0; i < labels.length; i += 1) {
    await page.keyboard.press('a');
    // Wait for the created node to render (a keyboard user waits for the card
    // before pressing Enter to rename it).
    await expect(page.locator('.node')).toHaveCount(i + 1);
    await page.keyboard.press('Enter');
    await expect(page.locator('.editing').first()).toBeVisible();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(labels[i]);
    await page.keyboard.press('Enter');
    await expect(page.locator('.editing')).toHaveCount(0);
    if (i < labels.length - 1) await page.keyboard.press('Escape');
  }
  await expect(page.locator('.node')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() =>
    window.app.graphs.current.nodes().every(node => node.NodeType === 'dense'))).toBe(true);

  // Types + colors for the selected node via palette commands.
  await paletteRun(page, 'Set node type: ML · MoE');
  await paletteRun(page, 'Set node color: orange');
  await expect.poll(() => page.evaluate(() => {
    const node = window.app.graphs.current.nodes().at(-1);
    return `${node.NodeType}:${node.Color}`;
  })).toBe('moe:orange');

  // Chain the blocks with Tab (select source) + `e` + the target's overlay
  // letter. All input is keyboard; evaluate calls only observe what a user
  // sees (which node is highlighted, which letter hangs on the target).
  const selectedLabel = () => page.evaluate(() => {
    const ref = window.app.selection.selected();
    return ref?.kind === 'node' ? window.app.graphs.current.getNode(ref.id)?.Label.text : null;
  });
  const overlayLetterFor = (label) => page.evaluate((label) => {
    const target = window.app.graphs.current.nodes().find(node => node.Label.text === label);
    const el = [...document.querySelectorAll('.picker-letter')].find(candidate =>
      (candidate.closest('[data-item-id]')?.getAttribute('data-item-id')
        ?? candidate.getAttribute('data-item-id')) === target?.id);
    return el?.textContent?.trim().toLowerCase() ?? null;
  }, label);
  const connect = async (fromLabel, toLabel, expected) => {
    for (let i = 0; i < 8 && (await selectedLabel()) !== fromLabel; i += 1) await page.keyboard.press('Tab');
    expect(await selectedLabel()).toBe(fromLabel);
    await page.keyboard.press('e');
    await expect(page.locator('.picker-letter').first()).toBeVisible();
    const letter = await overlayLetterFor(toLabel);
    expect(letter, `picker letter for ${toLabel}`).toBeTruthy();
    await page.keyboard.press(letter);
    await expect.poll(() => page.evaluate(() => window.app.graphs.current.edges().length)).toBe(expected);
  };
  await connect('MLA attention', 'Expert router', 1);
  await connect('Expert router', 'Shared expert', 2);
  await connect('Expert router', 'Routed experts', 3);
  await expect.poll(() => page.evaluate(() =>
    window.app.graphs.current.edges().every(edge => edge.EdgeKind === 'plain'))).toBe(true);

  // Restyle the router→routed edge: letter-pick it, then set the kind.
  await paletteRun(page, 'Select edge');
  await expect(page.locator('.picker-letter').first()).toBeVisible();
  const edgeLetter = await page.evaluate(() => {
    const nodes = window.app.graphs.current.nodes();
    const router = nodes.find(node => node.Label.text === 'Expert router');
    const routed = nodes.find(node => node.Label.text === 'Routed experts');
    const target = window.app.graphs.current.edges().find(edge => edge.From === router.id && edge.To === routed.id);
    const el = [...document.querySelectorAll('.picker-letter')].find(candidate =>
      (candidate.closest('[data-item-id]')?.getAttribute('data-item-id')
        ?? candidate.getAttribute('data-item-id')) === target?.id);
    return el?.textContent?.trim().toLowerCase() ?? null;
  });
  expect(edgeLetter, 'picker letter for the router→routed edge').toBeTruthy();
  await page.keyboard.press(edgeLetter);
  await expect.poll(() => page.evaluate(() => window.app.selection.selected()?.kind)).toBe('edge');
  await paletteRun(page, 'Set edge appearance: Dashed line');
  await expect.poll(() => page.evaluate(() =>
    window.app.graphs.current.edges().filter(edge => edge.EdgeKind === 'dashed').length)).toBe(1);

  // Group the expert blocks by search, then badge + legend via properties.
  await paletteRun(page, 'Select by search');
  await page.keyboard.type('expert');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.app.selection.selectedAll().length)).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Control+g');
  await expect.poll(() => page.evaluate(() => window.app.graphs.current.itemsOfKind('container').length)).toBe(1);

  await expect.poll(() => page.evaluate(() => window.app.selection.selected()?.kind)).toBe('container');
  await paletteRun(page, 'Open item inspector');
  await expect(page.locator('.properties')).toHaveCount(1);
  await page.getByRole('button', { name: 'Toggle Structure properties' }).press('Enter');
  await page.locator('[data-field="legend"]').fill('blue Shared expert\norange Routed experts');
  await page.locator('[data-field="multiplier"]').fill('60×');
  await page.keyboard.press('Escape');

  const state = await model(page);
  expect(state.preset).toBe('architecture');
  expect(state.nodes).toHaveLength(4);
  expect(state.edges.map(edge => edge.kind).sort()).toEqual(['dashed', 'plain', 'plain']);
  expect(state.containers).toEqual([expect.objectContaining({
    legend: [
      { color: 'blue', label: 'Shared expert' },
      { color: 'orange', label: 'Routed experts' },
    ],
    multiplier: '60×',
  })]);
  expect(state.containers[0].children).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.container-legend')).toHaveCount(1);
  await expect(page.locator('.container-multiplier')).toHaveText('60×');
});
