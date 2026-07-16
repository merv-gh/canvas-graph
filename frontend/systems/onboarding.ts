import type { Registry } from '../core';
import { Slots } from '../types';

declare module '../types' {
  interface CustomEvents {
    'onboarding.open': void;
  }
}

const SHOW_DEMO_COOKIE = 'showDemo';
const MERMAID_EXAMPLE = `flowchart LR
  Idea[Capture idea] --> Shape[Arrange the graph]
  Shape --> Check{Does it explain itself?}
  Check -->|yes| Share[Share the link]
  Check -->|not yet| Shape`;

export const shouldShowDemo = (cookie: string) =>
  !cookie.split(';').map(part => part.trim()).includes(`${SHOW_DEMO_COOKIE}=false`);

const rememberDemoWasShown = () => {
  document.cookie = `${SHOW_DEMO_COOKIE}=false; Max-Age=31536000; Path=/; SameSite=Lax`;
};

const key = (value: string, label: string) => {
  const item = document.createElement('li');
  const keyboard = document.createElement('kbd');
  keyboard.textContent = value;
  const text = document.createElement('span');
  text.textContent = label;
  item.append(keyboard, text);
  return item;
};

const topology = (kind: 'c4' | 'radial' | 'sequence' | 'list') => {
  const preview = document.createElement('span');
  preview.className = `onboarding-topology topology-${kind}`;
  preview.setAttribute('aria-hidden', 'true');
  const count = kind === 'radial' ? 7 : kind === 'sequence' ? 5 : kind === 'list' ? 8 : 6;
  for (let index = 0; index < count; index++) {
    const dot = document.createElement('i');
    dot.style.setProperty('--i', `${index}`);
    preview.append(dot);
  }
  return preview;
};

const example = (command: string, kind: 'c4' | 'radial' | 'sequence' | 'list', title: string, description: string) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'onboarding-example';
  button.dataset.command = command;
  const copy = document.createElement('span');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const detail = document.createElement('small');
  detail.textContent = description;
  const warning = document.createElement('small');
  warning.className = 'onboarding-example-warning';
  warning.textContent = 'Replaces this graph · Undo available';
  copy.append(heading, detail, warning);
  button.append(topology(kind), copy);
  return button;
};

const guideView = () => {
  const guide = document.createElement('section');
  guide.className = 'onboarding';

  const intro = document.createElement('header');
  intro.className = 'onboarding-intro';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'onboarding-eyebrow';
  eyebrow.textContent = 'A field guide to this canvas';
  const title = document.createElement('h1');
  title.textContent = 'Map an idea. Keep it editable.';
  const lead = document.createElement('p');
  lead.textContent = 'Tap an item to select it, drag to arrange it, then edit every part in place.';
  intro.append(eyebrow, title, lead);

  const shortcuts = document.createElement('ol');
  shortcuts.className = 'onboarding-keys';
  shortcuts.append(
    key('Tap', 'Select an item and reveal its actions'),
    key('Drag', 'Arrange a node or pan empty canvas'),
    key('A', 'Create the next item in the active layout'),
    key('Shift+A', 'Create a connected branch and keep its parent selected'),
    key('V · H · T · R', 'Vertical, horizontal, tree, or radial layout'),
    key('Enter', 'Rename the selected item'),
    key('E', 'Connect two nodes'),
    key('Z', 'Fit the whole graph'),
    key('P', 'Find any action'),
  );

  const examples = document.createElement('section');
  examples.className = 'onboarding-examples';
  const examplesHead = document.createElement('div');
  examplesHead.className = 'onboarding-section-head';
  examplesHead.innerHTML = '<strong>Four editable examples</strong><span>Open one, then edit every part.</span>';
  const grid = document.createElement('div');
  grid.className = 'onboarding-example-grid';
  grid.append(
    example('demo.render-c4', 'c4', 'C4 architecture', 'Nested systems, containers, and ownership'),
    example('demo.render-math', 'radial', 'Expected value', 'A radial map from intuition to formula'),
    example('demo.render-workflow', 'sequence', 'Delivery workflow', 'A sequence with review and a return loop'),
    example('demo.render-game', 'list', 'Game design map', 'A detailed vertical list with connected nesting'),
  );
  examples.append(examplesHead, grid);

  const mermaid = document.createElement('section');
  mermaid.className = 'onboarding-mermaid';
  const mermaidCopy = document.createElement('div');
  const mermaidTitle = document.createElement('strong');
  mermaidTitle.textContent = 'Already use Mermaid?';
  const mermaidHint = document.createElement('p');
  mermaidHint.textContent = 'Edit this flowchart, validate it, then review the replacement before importing.';
  mermaidCopy.append(mermaidTitle, mermaidHint);
  const textarea = document.createElement('textarea');
  textarea.className = 'onboarding-mermaid-source';
  textarea.value = MERMAID_EXAMPLE;
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', 'Mermaid flowchart source');
  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'primary onboarding-mermaid-import';
  importButton.dataset.command = 'onboarding.mermaid.import';
  importButton.textContent = 'Preview import';
  mermaid.append(mermaidCopy, textarea, importButton);

  guide.append(intro, shortcuts, examples, mermaid);
  return guide;
};

export function registerOnboarding(system: Registry) {
  system('onboarding', ({ on, emit, contexts, contribute }) => {
    let guideOpen = false;
    contexts.commands.register([
      { id: 'onboarding.open', label: 'Open getting-started guide', group: 'help' },
      {
        id: 'onboarding.mermaid.import',
        label: 'Preview Mermaid import',
        event: 'graph.import.mermaid',
        group: 'graph',
        hidden: true,
        payload: () => {
          const source = contexts.places.el('modal')?.querySelector<HTMLTextAreaElement>('.onboarding-mermaid-source')?.value ?? '';
          return { source };
        },
      },
    ]);
    contribute({ surface: 'top', command: 'onboarding.open', kind: 'button', text: 'Guide', label: 'Open getting-started guide', slot: Slots.End, order: 75 });

    const open = () => {
      guideOpen = true;
      emit('modal.open', { title: 'Start here', visual: 'onboarding', body: guideView });
      queueMicrotask(() => {
        const source = contexts.places.el('modal')?.querySelector<HTMLTextAreaElement>('.onboarding-mermaid-source');
        if (!source) return;
        source.setSelectionRange(0, 0);
        source.scrollTop = 0;
        source.scrollLeft = 0;
      });
    };
    on('onboarding.open', open);
    on('modal.closed', () => { guideOpen = false; });
    on('demo.loaded', () => { if (guideOpen) emit('modal.close'); });
    on('graph.imported', () => { if (guideOpen) emit('modal.close'); });
    on('app.start', () => {
      // A canonical `?demo=` URL should land directly on its canvas.
      if (new URLSearchParams(location.search).has('demo')) return;
      if (!shouldShowDemo(document.cookie)) return;
      rememberDemoWasShown();
      queueMicrotask(open);
    });
  }, { requires: ['modal', 'demo', 'share'] });
}
