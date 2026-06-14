import { describe, expect, it } from 'vitest';
import { bootApp, runCommand, settle } from '../testkit';

describe("Left panel can be toggled with keyboard shortcut B", () => {
  it('replays the sequence and asserts', async () => {
    const ctx = bootApp();
    await settle();
    expect(runCommand(ctx, "view.left.toggle"), "command view.left.toggle should run").toBe(true);
    await settle();
    expect(ctx.contexts.commands.get("view.left.toggle")?.input?.key).toEqual("b");
  });
});
