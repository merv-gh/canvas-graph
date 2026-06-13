import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from '../v2-testkit';

describe("detail-shortcuts", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootV2();
    await settle();
    expect(runCommand(ctx, "detail.less"), "command detail.less should run").toBe(true);
    await settle();
    expect(runCommand(ctx, "detail.more"), "command detail.more should run").toBe(true);
    await settle();
    expect(ctx.contexts.commands.get("detail.less")?.input?.key).toEqual("[");
    expect(ctx.contexts.commands.get("detail.more")?.input?.key).toEqual("]");
  });
});
