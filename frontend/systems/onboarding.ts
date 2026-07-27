import type { Registry } from '../core';
import { Slots } from '../types';

declare module '../types' {
  interface CustomEvents {
    'onboarding.open': void;
  }
}

const SHOW_DEMO_COOKIE = 'showDemo';
const MERMAID_EXAMPLE = `flowchart LR
  Client --> Gateway[API Gateway]
  Gateway --> Orders[Spring Order Service]
  Orders --> DB[(Postgres)]
  Orders --> Cache[(Redis)]
  Orders -->|order.created| Kafka{{Kafka}}
  Kafka --> Inventory[Spring Inventory Service]`;

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

type Brand = 'spring' | 'kafka' | 'postgres' | 'redis' | 'gateway' | 'domain' | 'ai' | 'agent' | 'workflow';
const BRAND_LABEL: Record<Brand, string> = {
  spring: 'Spring', kafka: 'Kafka', postgres: 'Postgres', redis: 'Redis', gateway: 'Gateway',
  domain: 'Domain', ai: 'AI', agent: 'Agents', workflow: 'Workflow',
};

const brandIcon = (brand: Brand) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('onboarding-brand-icon');
  const path = (d: string) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    svg.append(el);
  };
  const circle = (cx: number, cy: number, r: number) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('cx', `${cx}`); el.setAttribute('cy', `${cy}`); el.setAttribute('r', `${r}`);
    svg.append(el);
  };
  if (brand === 'spring') path('M4 15c5-9 12-9 17-10-1 7-5 14-13 14-2 0-4-1-4-4Zm2 2c4-4 8-7 13-9');
  else if (brand === 'kafka') {
    path('M7 7l5 5m0 0 5-6m-5 6 5 6'); circle(6, 6, 2.3); circle(12, 12, 2.3); circle(18, 5, 2.3); circle(18, 19, 2.3);
  } else if (brand === 'postgres') path('M5 7c0-3 14-3 14 0v10c0 3-14 3-14 0V7Zm0 0c0 3 14 3 14 0M5 12c0 3 14 3 14 0');
  else if (brand === 'redis') path('M3 8l9-4 9 4-9 4-9-4Zm0 4 9 4 9-4M3 16l9 4 9-4');
  else if (brand === 'gateway') path('M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Zm-4 9h8m-3-3 3 3-3 3');
  else if (brand === 'domain') path('M5 5h6v6H5V5Zm8 8h6v6h-6v-6Zm-2-5h4v5M8 11v5h5');
  else if (brand === 'ai') path('M8 4h8v4h4v8h-4v4H8v-4H4V8h4V4Zm1 6h6m-6 4h6');
  else if (brand === 'agent') path('M12 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM4 21c1-4 4-6 8-6s7 2 8 6');
  else path('M4 7h10m-4-3 4 3-4 3M20 17H10m4-3-4 3 4 3');
  return svg;
};

const architecturePreview = (brands: Brand[]) => {
  const preview = document.createElement('span');
  preview.className = 'onboarding-architecture';
  preview.setAttribute('aria-hidden', 'true');
  brands.forEach((brand, index) => {
    const token = document.createElement('i');
    token.dataset.brand = brand;
    token.append(brandIcon(brand));
    const label = document.createElement('b');
    label.textContent = BRAND_LABEL[brand];
    token.append(label);
    preview.append(token);
    if (index < brands.length - 1) {
      const arrow = document.createElement('span');
      arrow.textContent = '→';
      preview.append(arrow);
    }
  });
  return preview;
};

const example = (command: string, brands: Brand[], title: string, description: string) => {
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
  button.append(architecturePreview(brands), copy);
  return button;
};

const guideView = () => {
  const guide = document.createElement('section');
  guide.className = 'onboarding';

  const intro = document.createElement('header');
  intro.className = 'onboarding-intro';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'onboarding-eyebrow';
  eyebrow.textContent = 'Start with a production-shaped map';
  const title = document.createElement('h1');
  title.textContent = 'Sketch the system you can actually ship.';
  const lead = document.createElement('p');
  lead.textContent = 'Open a compact example, then replace services, boundaries, and protocols with your own.';
  intro.append(eyebrow, title, lead);

  const shortcuts = document.createElement('ol');
  shortcuts.className = 'onboarding-keys';
  shortcuts.append(
    key('Tap', 'Select an item and reveal its actions'),
    key('Drag', 'Arrange a node or pan empty canvas'),
    key('Add', 'Places one node now; click a container to nest the next'),
    key('E', 'Connect two services'),
    key('Z', 'Fit the whole architecture'),
  );

  const examples = document.createElement('section');
  examples.className = 'onboarding-examples';
  const examplesHead = document.createElement('div');
  examplesHead.className = 'onboarding-section-head';
  examplesHead.innerHTML = '<strong>Architecture examples</strong><span>Small enough to understand in one glance.</span>';
  const grid = document.createElement('div');
  grid.className = 'onboarding-example-grid';
  grid.append(
    example('demo.render-c4', ['gateway', 'spring', 'kafka', 'postgres', 'redis'], 'Checkout microservices', 'Spring services, event flow, cache, and durable data'),
    example('demo.render-flowchart', ['gateway', 'spring', 'workflow'], 'Order request path', 'Decision points, failure paths, and explicit outcomes'),
    example('demo.render-uml', ['domain', 'spring', 'postgres'], 'Ordering domain', 'Entities, repository boundary, and payment contract'),
    example('demo.render-kimi-k2', ['ai', 'gateway', 'redis'], 'Kimi K2 inference', 'Sparse MoE blocks and the serving path around them'),
    example('demo.render-agent-observability', ['agent', 'workflow', 'postgres'], 'Agent run operations', 'Handoffs, artifacts, metrics, and approval gates'),
    example('demo.render-workflow', ['workflow', 'spring', 'domain'], 'Delivery workflow', 'A readable state machine with named transitions'),
    example('demo.render-mindmap', ['domain', 'workflow', 'agent'], 'Platform capabilities', 'A capability map with clear branches and ownership'),
    example('demo.render-outline', ['workflow', 'domain', 'spring'], 'Migration rollout', 'Nested workstreams that stay readable as they grow'),
    example('demo.render-math', ['domain', 'ai', 'postgres'], 'Expected-value model', 'A compact radial map for one quantitative decision'),
  );
  examples.append(examplesHead, grid);

  const mermaid = document.createElement('details');
  mermaid.className = 'onboarding-mermaid';
  const summary = document.createElement('summary');
  summary.textContent = 'Import an existing Mermaid architecture';
  const mermaidCopy = document.createElement('div');
  const mermaidTitle = document.createElement('strong');
  mermaidTitle.textContent = 'Already use Mermaid?';
  const mermaidHint = document.createElement('p');
  mermaidHint.textContent = 'Edit this flowchart, validate it, then review the replacement before importing.';
  const markdownHint = document.createElement('p');
  markdownHint.className = 'onboarding-markdown-hint';
  markdownHint.textContent = 'Markdown outlines work too: paste headings and nested lists into the top-bar Import to map them as nested nodes.';
  mermaidCopy.append(mermaidTitle, mermaidHint, markdownHint);
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
  mermaid.append(summary, mermaidCopy, textarea, importButton);

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
    contribute({ surface: 'top', command: 'onboarding.open', kind: 'button', icon: 'help', text: 'Guide', label: 'Open getting-started guide', slot: Slots.End, order: 75, group: 'overflow' });

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
