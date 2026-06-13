// Read-only access to the code-review-graph SQLite index (.code-review-graph/graph.db).
// Queried via python3's sqlite3 (always present on macOS; node:sqlite is still
// noisy-experimental on this Node). The index lives in the REAL repo and may
// lag workspace edits by a build — fine for discovery, not for verification.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PY = `
import json, sqlite3, sys
db, mode, query, repo = sys.argv[1:5]
c = sqlite3.connect(db)
c.row_factory = sqlite3.Row
def rel(p): return p.replace(repo + '/', '') if p else p
def node_rows(rows):
    return [{ 'kind': r['kind'], 'name': r['name'], 'file': rel(r['file_path']), 'line': r['line_start'] } for r in rows]
if mode == 'find':
    rank = "CASE n.kind WHEN 'Function' THEN 0 WHEN 'Class' THEN 0 WHEN 'Type' THEN 1 WHEN 'Test' THEN 3 ELSE 2 END"
    try:
        rows = c.execute(f"SELECT n.* FROM nodes_fts f JOIN nodes n ON n.id = f.rowid WHERE nodes_fts MATCH ? AND n.kind != 'File' ORDER BY {rank} LIMIT 12", (query,)).fetchall()
    except sqlite3.OperationalError:
        rows = []
    if not rows:
        rows = c.execute(f"SELECT * FROM nodes n WHERE name LIKE ? AND kind != 'File' ORDER BY {rank} LIMIT 12", (f'%{query}%',)).fetchall()
    print(json.dumps(node_rows(rows)))
elif mode in ('callers', 'callees'):
    col, other = ('target_qualified', 'source_qualified') if mode == 'callers' else ('source_qualified', 'target_qualified')
    rows = c.execute(f"SELECT e.{other} AS q, e.file_path, e.line FROM edges e WHERE e.kind = 'CALLS' AND e.{col} LIKE ? LIMIT 15", (f'%{query}%',)).fetchall()
    print(json.dumps([{ 'qualified': r['q'], 'file': rel(r['file_path']), 'line': r['line'] } for r in rows]))
elif mode == 'file':
    rows = c.execute("SELECT * FROM nodes WHERE file_path LIKE ? AND kind != 'File' ORDER BY line_start LIMIT 40", (f'%{query}',)).fetchall()
    print(json.dumps(node_rows(rows)))
elif mode == 'tests':
    rows = c.execute("SELECT e.target_qualified AS q, e.file_path, e.line FROM edges e WHERE e.kind = 'TESTED_BY' AND e.source_qualified LIKE ? LIMIT 15", (f'%{query}%',)).fetchall()
    print(json.dumps([{ 'test': r['q'], 'file': rel(r['file_path']), 'line': r['line'] } for r in rows]))
else:
    print(json.dumps({ 'error': 'unknown mode ' + mode }))
`;

export function graphQuery(repoRoot, mode, query) {
  const db = join(repoRoot, '.code-review-graph/graph.db');
  if (!existsSync(db)) return { error: 'graph.db not found — run code-review-graph build' };
  try {
    const out = execFileSync('python3', ['-c', PY, db, mode, query, repoRoot], { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(out);
  } catch (err) {
    return { error: `graph query failed: ${String(err.message).slice(0, 200)}` };
  }
}
