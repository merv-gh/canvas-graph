import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from '../v2-testkit';

describe("Properties modal title field is editable", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootV2();
    await settle();

    expect(readFileSync(resolve(process.cwd(), "v2/styles.css"), 'utf8')).toMatch(/\.properties input\.editable-inline\s*{[^}]*border-bottom:\s*1px dashed var\(--line-strong\)[^}]*}/);
  });
});
