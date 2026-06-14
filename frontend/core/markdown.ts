const appendInline = (parent: Node, text: string) => {
  const token = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(token)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, index)));
    if (raw.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = raw.slice(2, -2);
      parent.appendChild(strong);
    } else if (raw.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = raw.slice(1, -1);
      parent.appendChild(code);
    } else {
      const [, label, href] = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      const link = document.createElement('a');
      link.textContent = label ?? raw;
      const safeHref = href && /^(https?:|mailto:|#|\/)/i.test(href) ? href : '#';
      link.href = safeHref;
      link.rel = 'noreferrer';
      link.target = '_blank';
      parent.appendChild(link);
    }
    cursor = index + raw.length;
  }
  if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
};

export function renderMarkdown(markdown: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let list: HTMLUListElement | null = null;
  const endList = () => { list = null; };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { endList(); continue; }
    if (trimmed.startsWith('- ')) {
      list ??= document.createElement('ul');
      if (!fragment.contains(list)) fragment.append(list);
      const item = document.createElement('li');
      appendInline(item, trimmed.slice(2));
      list.append(item);
      continue;
    }
    endList();
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    const block = document.createElement(heading ? 'h4' : 'p');
    appendInline(block, heading?.[2] ?? trimmed);
    fragment.append(block);
  }
  return fragment;
}
