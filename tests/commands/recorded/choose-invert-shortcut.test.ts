import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from '../testkit';

describe("choose-invert-shortcut", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootApp();
    await settle();

    expect(ctx.contexts.commands.get("choose.invert")?.input?.key).toEqual("i");
  });
});
