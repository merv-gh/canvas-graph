import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from '../testkit';

describe("Properties modal title field is editable", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootApp();
    await settle();

    expect(readFileSync(resolve(process.cwd(), "frontend/styles.css"), 'utf8')).toMatch(/\.properties input\.editable-inline\s*{[^}]*border-bottom:\s*1px dashed var\(--line-strong\)[^}]*}/);
  });
});
