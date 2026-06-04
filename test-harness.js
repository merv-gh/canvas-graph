/* ============================================================
   CASE RECORDER / EXPORT
   ============================================================ */
const CASE_RECORD_SKIP = new Set([
  'compAdded', 'entityRemoved', 'worldCleared',
  'cmd-case-record-toggle', 'cmd-case-export',
  'case-record-started', 'case-record-stopped', 'case-exported',
]);

function caseTimestampName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `case-${stamp}`;
}
function stablePayload(data) {
  try { return JSON.parse(JSON.stringify(data || {})); }
  catch (_) { return {}; }
}
function snapshotGraph(label = 'current') {
  const nodeIds = world.q(['Transform','Node']);
  const refById = new Map(nodeIds.map((id, index) => [id, `n${index + 1}`]));
  const nodes = nodeIds.map(id => {
    const t = world.get(id, 'Transform');
    const n = world.get(id, 'Node');
    return {
      ref: refById.get(id),
      title: n.title,
      body: n.body,
      at: [t.x, t.y, t.z],
      parent: n.parentId ? refById.get(n.parentId) : null,
      collapsed: !!n.collapsed,
    };
  });
  const edges = world.q(['Edge']).map(id => {
    const ed = world.get(id, 'Edge');
    return {
      from: refById.get(ed.from),
      to: refById.get(ed.to),
      label: ed.label || '',
    };
  }).filter(edge => edge.from && edge.to);

  return {
    label,
    camera: { ...Context.camera },
    layoutMode: Context.layoutMode,
    selected: Context.selectedId ? refById.get(Context.selectedId) || null : null,
    nodes,
    edges,
  };
}
function restoreGraphSnapshot(snapshot) {
  resetGraphState(snapshot.camera || defaultScreenshotCamera);
  Context.layoutMode = snapshot.layoutMode || 'radial';
  const idByRef = new Map();

  for (const node of snapshot.nodes || []) {
    const parentId = node.parent ? idByRef.get(node.parent) || null : null;
    const at = node.at || [0, 0, 0];
    const id = createNode(at[0], at[1], at[2], node.title || 'Node', node.body || '', parentId);
    idByRef.set(node.ref, id);
    const n = world.get(id, 'Node');
    if (n) n.collapsed = !!node.collapsed;
  }

  for (const edge of snapshot.edges || []) {
    const from = idByRef.get(edge.from);
    const to = idByRef.get(edge.to);
    if (from && to) createEdge(from, to, edge.label || '');
  }

  Context.selectedId = snapshot.selected ? idByRef.get(snapshot.selected) || null : null;
  render();
  return idByRef;
}
function caseCheckpoints(caseData) {
  if (Array.isArray(caseData.checkpoints) && caseData.checkpoints.length) return caseData.checkpoints;
  if (caseData.snapshot) return [{ label: caseData.name || 'snapshot', snapshot: caseData.snapshot }];
  return [{ label: caseData.name || 'snapshot', snapshot: caseData }];
}
function loadCaseCheckpoint(caseData, checkpoint = 0) {
  const checkpoints = caseCheckpoints(caseData);
  const target = typeof checkpoint === 'string' && checkpoint
    ? checkpoints.find(cp => cp.label === checkpoint) || checkpoints[Number(checkpoint)]
    : checkpoints[Number(checkpoint) || 0];
  if (!target?.snapshot) throw new Error(`Missing case checkpoint: ${checkpoint}`);
  restoreGraphSnapshot(target.snapshot);
  document.body.dataset.fixture = '';
  document.body.dataset.script = '';
  document.body.dataset.case = caseData.name || 'case';
  document.body.dataset.checkpoint = target.label || '';
  document.body.dataset.visibleNodeCount = String(visibleNodeCount());
  document.body.dataset.fixtureReady = '1';
  return { caseName: caseData.name || 'case', checkpoint: target.label || '', checkpointCount: checkpoints.length };
}
async function loadCaseFromUrl(caseUrl, checkpoint = 0) {
  const url = caseUrl.startsWith('/') ? caseUrl : `/cases/${caseUrl}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Unable to load case ${url}: ${res.status}`);
  const data = await res.json();
  return loadCaseCheckpoint(data, checkpoint);
}
function newCaseEnvelope(name, checkpoints) {
  return {
    schemaVersion: 1,
    name,
    viewport: { width: innerWidth, height: innerHeight },
    assertions: {
      noPixelIntersections: true,
      noDomIntersections: true,
    },
    checkpoints,
  };
}
function currentCaseExport() {
  const rec = window.__caseRecorder;
  if (rec?.checkpoints?.length) {
    return newCaseEnvelope(rec.name, rec.checkpoints.map(cp => ({ ...cp, payload: stablePayload(cp.payload) })));
  }
  return newCaseEnvelope(caseTimestampName(), [
    { label: 'current', snapshot: snapshotGraph('current') },
  ]);
}
function refreshCaseRecordBtn() {
  const btn = document.getElementById('btn-case-record');
  if (!btn) return;
  const rec = window.__caseRecorder;
  const count = rec?.checkpoints?.length || 0;
  btn.textContent = rec?.active ? `Rec: ${count}` : 'Rec: off';
  btn.classList.toggle('active', !!rec?.active);
}
function startCaseRecording() {
  const name = caseTimestampName();
  window.__caseRecorder = {
    active: true,
    name,
    sequence: 0,
    checkpoints: [
      { label: '000 initial', snapshot: snapshotGraph('000 initial') },
    ],
  };
  refreshCaseRecordBtn();
}
function stopCaseRecording() {
  if (window.__caseRecorder) window.__caseRecorder.active = false;
  refreshCaseRecordBtn();
}
function recordCaseEvent(name, data) {
  const rec = window.__caseRecorder;
  if (!rec?.active || CASE_RECORD_SKIP.has(name)) return;
  rec.sequence += 1;
  const label = `${String(rec.sequence).padStart(3, '0')} ${name}`;
  rec.checkpoints.push({
    label,
    event: name,
    payload: stablePayload(data),
    snapshot: snapshotGraph(label),
  });
  refreshCaseRecordBtn();
}
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand('copy');
  ta.remove();
}
async function exportCaseToClipboard() {
  const payload = currentCaseExport();
  const text = JSON.stringify(payload, null, 2);
  await copyTextToClipboard(text);
  const btn = document.getElementById('btn-case-export');
  if (btn) {
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1200);
  }
  bus.emit('case-exported', { checkpoints: payload.checkpoints.length });
}
bus.on('cmd-case-record-toggle', () => {
  if (window.__caseRecorder?.active) {
    stopCaseRecording();
    bus.emit('case-record-stopped');
  } else {
    startCaseRecording();
    bus.emit('case-record-started');
  }
});
bus.on('cmd-case-export', () => {
  exportCaseToClipboard().catch(err => {
    console.error(err);
    alert('Could not copy case to clipboard. See console for details.');
  });
});

document.getElementById('btn-case-record')?.addEventListener('click', () => bus.emit('cmd-case-record-toggle'));
document.getElementById('btn-case-export')?.addEventListener('click', () => bus.emit('cmd-case-export'));
window.__ecsCaseHarness = { recordEvent: recordCaseEvent };

/* ============================================================
   SCREENSHOT TEST HARNESS
   ============================================================ */
const queryParams = new URLSearchParams(location.search);

const screenshotFixtures = {
  separated: {
    camera: { x: 0, y: 0, zoom: 1, layerZ: 0 },
    nodes: [
      { at: [-140, 0, 0], title: 'A' },
      { at: [140, 0, 0], title: 'B' },
    ],
  },
  overlapping: {
    camera: { x: 0, y: 0, zoom: 1, layerZ: 0 },
    nodes: [
      { at: [-40, 0, 0], title: 'A' },
      { at: [40, 0, 0], title: 'B' },
    ],
  },
};

const defaultScreenshotCamera = { x: 0, y: 0, zoom: 1, layerZ: 0 };

function resetGraphState(camera = defaultScreenshotCamera) {
  stopDemo();
  world.clear();
  Context.selectedId = null;
  Context.mode = 'normal';
  Context.camera = { ...camera };
  Context.history = [];
  Context.lastVisited = null;
  Context.connectSource = null;
  Context.drag = { active: false, id: null, sx: 0, sy: 0, moved: false };
}

function buildScreenshotFixture(name) {
  const fixture = screenshotFixtures[name];
  if (!fixture) throw new Error(`Unknown screenshot fixture: ${name}`);
  resetGraphState(fixture.camera);
  const ids = fixture.nodes.map(node => createNode(node.at[0], node.at[1], node.at[2], node.title, node.body || '', node.parentId || null));
  for (const edge of fixture.edges || []) createEdge(ids[edge.from], ids[edge.to], edge.label || '');
  Context.selectedId = ids[0] || null;
  document.body.dataset.fixture = name;
  document.body.dataset.fixtureReady = '1';
}

function selectRef(refs, key) {
  bus.emit('node-select', { eid: refs[key] });
}

function addScriptNode(refs, key, data) {
  bus.emit('cmd-add-node', data);
  refs[key] = Context.selectedId;
}

const screenshotScripts = {
  demoMemory: [
    {
      checkpoint: 'root-added',
      fn: refs => addScriptNode(refs, 'jvm', { at: [0, -260, 0], title: 'JVM Runtime', parent: null }),
    },
    {
      checkpoint: 'top-level-expanded',
      fn: refs => {
        selectRef(refs, 'jvm');
        addScriptNode(refs, 'heap', { at: [-340, 40, 0], title: 'Heap', body: 'Object storage' });
        selectRef(refs, 'jvm');
        addScriptNode(refs, 'stack', { at: [340, 40, 0], title: 'JVM Stack', body: 'Per-thread' });
        selectRef(refs, 'jvm');
        addScriptNode(refs, 'meta', { at: [0, 0, 0], title: 'Metaspace', body: 'Class metadata' });
      },
    },
    {
      checkpoint: 'heap-children-just-added',
      fn: refs => {
        bus.emit('cmd-layer', { z: -300 });
        selectRef(refs, 'heap');
        addScriptNode(refs, 'eden', { at: [-420, 220, -300], title: 'Eden', body: 'New objects' });
        selectRef(refs, 'heap');
        addScriptNode(refs, 'surv', { at: [-190, 220, -300], title: 'Survivor', body: 'S0 / S1' });
        selectRef(refs, 'heap');
        addScriptNode(refs, 'old', { at: [40, 220, -300], title: 'Old Gen', body: 'Long-lived' });
      },
    },
    {
      checkpoint: 'stack-children-just-added',
      fn: refs => {
        selectRef(refs, 'stack');
        addScriptNode(refs, 't1', { at: [260, 220, -300], title: 'Thread-1', body: 'Local vars' });
        selectRef(refs, 'stack');
        addScriptNode(refs, 't2', { at: [500, 220, -300], title: 'Thread-2', body: 'Local vars' });
      },
    },
    {
      checkpoint: 'deep-object-just-added',
      fn: refs => {
        bus.emit('cmd-layer', { z: -600 });
        selectRef(refs, 'eden');
        addScriptNode(refs, 'obj', { at: [-520, 420, -600], title: 'Object', body: 'In Eden' });
      },
    },
    {
      checkpoint: 'deep-ref-just-added',
      fn: refs => {
        selectRef(refs, 't1');
        bus.emit('cmd-connect-start');
        addScriptNode(refs, 'ref1', { at: [340, 420, -600], title: 'ref', body: 'Local variable', connectFrom: refs.t1 });
      },
    },
    {
      checkpoint: 'heap-collapsed',
      fn: refs => {
        selectRef(refs, 'heap');
        bus.emit('cmd-collapse');
      },
    },
    {
      checkpoint: 'heap-expanded-again',
      fn: refs => {
        selectRef(refs, 'heap');
        bus.emit('cmd-collapse');
      },
    },
  ],
};

function visibleNodeCount() {
  return world.q(['Node']).filter(isVisible).length;
}

function runScreenshotScript(name, checkpoint) {
  const script = screenshotScripts[name];
  if (!script) throw new Error(`Unknown screenshot script: ${name}`);
  resetGraphState(defaultScreenshotCamera);
  const refs = {};
  let reached = null;

  for (const step of script) {
    step.fn(refs);
    reached = step.checkpoint;
    if (!checkpoint || reached === checkpoint) break;
  }

  if (checkpoint && reached !== checkpoint) throw new Error(`Unknown checkpoint "${checkpoint}" for screenshot script "${name}"`);
  render();
  document.body.dataset.fixture = '';
  document.body.dataset.script = name;
  document.body.dataset.checkpoint = reached || '';
  document.body.dataset.visibleNodeCount = String(visibleNodeCount());
  document.body.dataset.fixtureReady = '1';
  return { script: name, checkpoint: reached, refs: { ...refs }, visibleNodeCount: visibleNodeCount() };
}

window.__ecsGraphTest = {
  buildScreenshotFixture,
  runScreenshotScript,
  loadCaseCheckpoint,
  loadCaseFromUrl,
  resetGraphState,
  restoreGraphSnapshot,
  snapshotGraph,
  worldToScreen,
  renderNow: render,
  fixtures: Object.keys(screenshotFixtures),
  scripts: Object.fromEntries(Object.entries(screenshotScripts).map(([name, steps]) => [name, steps.map(step => step.checkpoint)])),
};

async function bootGraph() {
  const screenshotFixture = queryParams.get('fixture');
  const screenshotScript = queryParams.get('script');
  const screenshotCase = queryParams.get('case');
  const checkpoint = queryParams.get('checkpoint');
  if (screenshotCase) await loadCaseFromUrl(screenshotCase, checkpoint || 0);
  else if (screenshotFixture) buildScreenshotFixture(screenshotFixture);
  else if (screenshotScript) runScreenshotScript(screenshotScript, checkpoint);
  else buildJMM();
  scheduleRender();
}
bootGraph().catch(err => {
  console.error(err);
  document.body.dataset.fixtureReady = 'error';
  buildJMM();
  scheduleRender();
});
