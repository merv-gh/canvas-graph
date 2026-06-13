// Re-introduce the choose.invert shortcut gap in a workspace copy.
// This keeps the already-landed shortcut fix usable as a walker benchmark.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXED = "{ id: 'choose.invert', label: 'Invert choice', group: 'choose', available: () => allRefs().length > 0, shortcut: 'I', input: { on: 'keydown', key: 'i', prevent: true } },";
const BROKEN = "{ id: 'choose.invert', label: 'Invert choice', group: 'choose', available: () => allRefs().length > 0 },";

export async function setup(wsDir) {
  const choosePath = join(wsDir, 'v2/systems/choose.ts');
  const source = readFileSync(choosePath, 'utf8');
  if (!source.includes(FIXED)) {
    throw new Error('choose-invert-shortcut setup: command literal drifted, update walker/setup/choose-invert-shortcut.mjs');
  }
  writeFileSync(choosePath, source.replace(FIXED, BROKEN));
  rmSync(join(wsDir, 'tests/commands/recorded/choose-invert-shortcut.test.ts'), { force: true });
}
