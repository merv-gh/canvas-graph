import { describe, expect, it } from 'vitest';
import { shouldShowDemo } from '../../frontend/systems/onboarding';
import { bootApp, runCommand, settle } from './testkit';

describe('first-visit guide', () => {
  it('uses the showDemo cookie as a one-time visit marker', () => {
    expect(shouldShowDemo('')).toBe(true);
    expect(shouldShowDemo('theme=dark; showDemo=false')).toBe(false);
    expect(shouldShowDemo('showDemo=true')).toBe(true);
  });

  it('opens on first visit and lets the user reopen it from a command', async () => {
    document.cookie = 'showDemo=; Max-Age=0; Path=/';
    const ctx = bootApp({ onboarding: true });
    await settle();

    expect(document.querySelector('.onboarding')).not.toBeNull();
    expect(document.querySelectorAll('.onboarding-example')).toHaveLength(4);
    expect(document.cookie).toContain('showDemo=false');

    runCommand(ctx, 'modal.close');
    expect(document.querySelector('.onboarding')).toBeNull();
    expect(runCommand(ctx, 'onboarding.open')).toBe(true);
    expect(document.querySelector('.onboarding')).not.toBeNull();
  });

  it('loads canonical examples and converts editable Mermaid source', async () => {
    document.cookie = 'showDemo=false; Path=/';
    const ctx = bootApp({ onboarding: true, autoLayout: false });
    expect(runCommand(ctx, 'onboarding.open')).toBe(true);
    expect(runCommand(ctx, 'demo.render-c4')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes().some(node => node.Label.text === 'Commerce API')).toBe(true);
    expect(document.querySelector('.onboarding')).toBeNull();

    expect(runCommand(ctx, 'onboarding.open')).toBe(true);
    const source = document.querySelector<HTMLTextAreaElement>('.onboarding-mermaid-source')!;
    source.value = 'flowchart LR\nStart[Draft] --> Finish[Published]';
    expect(runCommand(ctx, 'onboarding.mermaid.import')).toBe(true);
    await settle();
    await settle();
    expect(document.querySelector('.import-preview')).not.toBeNull();
    expect(runCommand(ctx, 'graph.import.confirm')).toBe(true);
    await settle();
    expect(ctx.graphs.current.nodes().map(node => node.Label.text)).toEqual(['Draft', 'Published']);
    expect(document.querySelector('.onboarding')).toBeNull();
  });
});
