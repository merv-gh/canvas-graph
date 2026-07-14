import { flattenSnapshotTree, type SnapshotNode } from '../core';

const treeRow = (node: SnapshotNode, depth: number): HTMLElement => {
  const row = document.createElement('div');
  row.className = `debug-tree-row depth-${depth}`;
  row.dataset.path = node.code;
  const label = document.createElement('span');
  label.className = 'debug-tree-label';
  label.textContent = node.label;
  row.append(label);
  if (node.kind === 'literal') {
    const value = document.createElement('button');
    value.type = 'button';
    value.className = 'debug-tree-value';
    value.dataset.snapshotPick = '';
    value.dataset.code = node.code;
    value.dataset.matcher = node.value === null ? 'toBeNull' : node.value === undefined ? 'toBeUndefined' : 'toBe';
    value.dataset.expected = node.value === null || node.value === undefined ? '' : JSON.stringify(node.value);
    value.textContent = node.value === null ? 'null' : node.value === undefined ? 'undefined' : JSON.stringify(node.value);
    value.title = `Click → expect(${node.code}).${value.dataset.matcher}(${value.dataset.expected})`;
    row.append(value);
  } else if (node.kind === 'array') {
    const length = (node.value as unknown[]).length;
    const value = document.createElement('button');
    value.type = 'button';
    value.className = 'debug-tree-value debug-tree-array';
    value.dataset.snapshotPick = '';
    value.dataset.code = node.code;
    value.dataset.matcher = 'toHaveLength';
    value.dataset.expected = String(length);
    value.textContent = `Array(${length})`;
    value.title = `Click → expect(${node.code}).toHaveLength(${length})`;
    row.append(value);
  } else {
    const summary = document.createElement('span');
    summary.className = 'debug-tree-summary';
    summary.textContent = '{…}';
    row.append(summary);
  }
  return row;
};

export const buildDebugTree = (root: SnapshotNode, query: string): HTMLElement => {
  const list = document.createElement('div');
  list.className = 'debug-tree';
  const q = query.trim().toLowerCase();
  const flat = flattenSnapshotTree(root);
  const visible = q
    ? flat.filter(node => node.path.toLowerCase().includes(q)
      || node.code.toLowerCase().includes(q)
      || node.label.toLowerCase().includes(q))
    : flat;
  visible.forEach(node => {
    const depth = (node.path.match(/[.[]/g) || []).length;
    list.append(treeRow(node, depth));
  });
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'debug-tree-empty';
    empty.textContent = `No matches for "${query}".`;
    list.append(empty);
  }
  return list;
};

export const buildDebugAssertView = (options: {
  tree: SnapshotNode;
  query: string;
  traceCount: number;
  assertionCount: number;
  code: string;
}): HTMLElement => {
  const wrap = document.createElement('section');
  wrap.className = 'debug-assert';

  const left = document.createElement('div');
  left.className = 'debug-state';
  const search = document.createElement('input');
  search.className = 'debug-search';
  search.placeholder = 'Filter state… (ctx.graphs.current.nodes…)';
  search.value = options.query;
  search.autofocus = true;
  left.append(search, buildDebugTree(options.tree, options.query));

  const right = document.createElement('div');
  right.className = 'debug-test';
  const heading = document.createElement('div');
  heading.className = 'debug-test-head';
  const count = document.createElement('strong');
  count.textContent = `${options.traceCount} events captured · ${options.assertionCount} assertion${options.assertionCount === 1 ? '' : 's'}`;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.dataset.command = 'debug.assert.clear-asserts';
  clear.textContent = 'Clear asserts';
  clear.className = 'icon-button';
  heading.append(count, clear);

  const code = document.createElement('textarea');
  code.className = 'debug-code';
  code.spellcheck = false;
  code.value = options.code;

  const actions = document.createElement('div');
  actions.className = 'debug-actions';
  [['debug.assert.copy', 'Copy'], ['debug.assert.download', 'Download .test.ts'], ['debug.assert.replay', 'Replay in place']]
    .forEach(([command, text]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.command = command;
      button.textContent = text;
      actions.append(button);
    });
  right.append(heading, code, actions);
  wrap.append(left, right);
  return wrap;
};

export const buildDebugReplayView = (value: string): HTMLElement => {
  const wrap = document.createElement('section');
  wrap.className = 'debug-replay';
  const hint = document.createElement('p');
  hint.className = 'debug-replay-hint';
  hint.textContent = 'Paste a recorded trace (array of {name, data, at}) and Run.';
  const textarea = document.createElement('textarea');
  textarea.spellcheck = false;
  textarea.placeholder = '[\n  { "name": "editing.node.create", "data": {}, "at": 0 }\n]';
  textarea.value = value;
  const actions = document.createElement('div');
  actions.className = 'debug-actions';
  const run = document.createElement('button');
  run.type = 'button';
  run.dataset.command = 'debug.replay.run';
  run.textContent = 'Run';
  run.className = 'primary';
  actions.append(run);
  wrap.append(hint, textarea, actions);
  return wrap;
};
