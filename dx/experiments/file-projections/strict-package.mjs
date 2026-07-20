#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanRun, HERE, runDir, runFp, writeJson } from './shared.mjs';

const run = cleanRun(process.argv[2]);
const manifest = JSON.parse(readFileSync(join(HERE, 'runs', run, 'strict-worktree.json'), 'utf8'));
const worktree = manifest.worktree.path;
const out = runDir(run, 'strict-concepts');
const task = readFileSync(join(HERE, 'task.md'), 'utf8');
const query = task.replace(/\s+/g, ' ').slice(0, 500);
const conceptDir = join(worktree, 'concepts');
const conceptFiles = existsSync(conceptDir)
  ? readdirSync(conceptDir).filter(name => name.endsWith('.yaml')).sort()
  : [];

const architecture = runFp(['architecture', '-root', '.'], worktree);
const boundaries = runFp(['boundaries', '-root', '.', query], worktree);
const routedPath = runFp(['path', '-root', '.', query], worktree);
const materialized = [];
for (const name of conceptFiles.map(file => file.replace(/\.yaml$/, ''))) {
  const result = runFp(['architecture', 'materialize', name, '-root', '.'], worktree);
  materialized.push({ name, ok: result.exit_code === 0, output: result.output });
}

const yaml = conceptFiles.map(name => `## concepts/${name}\n\n\`\`\`yaml\n${readFileSync(join(conceptDir, name), 'utf8')}\n\`\`\``).join('\n\n');
const packet = `# Cold model-authored concept packet\n\nNo maintainer-authored implementation, source template, or change plan is included. Materialized source views remain on-demand tool reads so their token/read cost is measured.\n\n## Native boundaries\n\n\`\`\`text\n${boundaries.output}\n\`\`\`\n\n## Authored concepts\n\n${yaml}\n`;
writeFileSync(join(out, 'concept-packet.md'), packet);
writeFileSync(join(worktree, 'EVAL_CONCEPT_PACKET.md'), packet);
writeJson(join(out, 'packaging.json'), {
  schema_version: 1,
  run,
  concept_files: conceptFiles,
  architecture_ok: architecture.exit_code === 0,
  boundaries_ok: boundaries.exit_code === 0,
  path_ok: routedPath.exit_code === 0,
  materialized,
  interrupted_author_run: !existsSync(join(out, 'metrics.json')),
});
console.log(JSON.stringify({ run, concept_files: conceptFiles, materialized }, null, 2));
