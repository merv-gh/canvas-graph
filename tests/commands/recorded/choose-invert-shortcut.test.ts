import { describe, expect, it } from 'vitest';
import { bootV2, runCommand, settle } from '../v2-testkit';

describe("choose-invert-shortcut", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootV2();
    await settle();

    expect(ctx.contexts.commands.get("choose.invert")?.input?.key).toEqual("i");
  });
});
