export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'unordered-list'; items: string[] }
  | { kind: 'ordered-list'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string; language?: string }
  | { kind: 'rule' };

const headingOf = (line: string) => /^(#{1,6})\s+(.+)$/.exec(line.trim());
const unorderedOf = (line: string) => /^\s*[-+*]\s+(.+)$/.exec(line);
const orderedOf = (line: string) => /^\s*\d+[.)]\s+(.+)$/.exec(line);
const quoteOf = (line: string) => /^\s*>\s?(.*)$/.exec(line);
const fenceOf = (line: string) => /^\s*```\s*([\w-]*)\s*$/.exec(line);
const isRule = (line: string) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const startsBlock = (line: string) => !line.trim()
  || !!headingOf(line)
  || !!unorderedOf(line)
  || !!orderedOf(line)
  || !!quoteOf(line)
  || !!fenceOf(line)
  || isRule(line);

/** Parse the deliberately supported, safe Markdown block vocabulary. Raw HTML
 * is text, never executable markup; links are sanitized during rendering. */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = fenceOf(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !fenceOf(lines[index])) body.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', text: body.join('\n'), language: fence[1] || undefined });
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (isRule(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const quote = quoteOf(line);
    if (quote) {
      const text: string[] = [];
      while (index < lines.length) {
        const match = quoteOf(lines[index]);
        if (!match) break;
        text.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: 'quote', text: text.join(' ') });
      continue;
    }

    const unordered = unorderedOf(line);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = unorderedOf(lines[index]);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: 'unordered-list', items });
      continue;
    }

    const ordered = orderedOf(line);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = orderedOf(lines[index]);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: 'ordered-list', items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && !startsBlock(lines[index])) paragraph.push(lines[index++].trim());
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

/** Plain text used by layout estimation. It mirrors what inline rendering
 * exposes instead of budgeting literal `**`, link URLs, and other syntax. */
export const markdownPlainText = (markdown: string) => markdown
  .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/(`|\*\*|__|~~|\*|_)/g, '')
  .trim();

const appendInline = (parent: Node, text: string) => {
  const token = /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;
  for (const match of text.matchAll(token)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, index)));
    if (raw.startsWith('**') || raw.startsWith('__')) {
      const strong = document.createElement('strong');
      strong.textContent = raw.slice(2, -2);
      parent.appendChild(strong);
    } else if (raw.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = raw.slice(1, -1);
      parent.appendChild(code);
    } else if (raw.startsWith('~~')) {
      const deleted = document.createElement('del');
      deleted.textContent = raw.slice(2, -2);
      parent.appendChild(deleted);
    } else if (raw.startsWith('*') || raw.startsWith('_')) {
      const emphasis = document.createElement('em');
      emphasis.textContent = raw.slice(1, -1);
      parent.appendChild(emphasis);
    } else {
      const [, label, href] = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      const link = document.createElement('a');
      link.textContent = label ?? raw;
      const safeHref = href && /^(https?:|mailto:|#|\/)/i.test(href) ? href : '#';
      link.href = safeHref;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      parent.appendChild(link);
    }
    cursor = index + raw.length;
  }
  if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)));
};

export function renderMarkdown(markdown: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  parseMarkdown(markdown).forEach(block => {
    if (block.kind === 'rule') {
      fragment.append(document.createElement('hr'));
      return;
    }
    if (block.kind === 'code') {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      if (block.language) code.dataset.language = block.language;
      pre.append(code);
      fragment.append(pre);
      return;
    }
    if (block.kind === 'unordered-list' || block.kind === 'ordered-list') {
      const list = document.createElement(block.kind === 'ordered-list' ? 'ol' : 'ul');
      block.items.forEach(text => {
        const item = document.createElement('li');
        appendInline(item, text);
        list.append(item);
      });
      fragment.append(list);
      return;
    }
    if (block.kind === 'heading') {
      const heading = document.createElement(`h${block.level}`);
      appendInline(heading, block.text);
      fragment.append(heading);
      return;
    }
    const element = document.createElement(block.kind === 'quote' ? 'blockquote' : 'p');
    appendInline(element, block.text);
    fragment.append(element);
  });
  return fragment;
}

// ---------------------------------------------------------------------------
// Outline parsing (markdown import). Independent of parseMarkdown so the
// text-layout measurement path is untouched.
// ---------------------------------------------------------------------------
export type OutlineItem = { text: string; description?: string; children: OutlineItem[] };
export type OutlineEntry =
  | { kind: 'heading'; level: number; text: string; description?: string; items: OutlineItem[] }
  | { kind: 'items'; items: OutlineItem[] };

// Indent-capturing list regexes — the shared unorderedOf/orderedOf above strip
// indentation, which the nesting stack needs, so the outline keeps its own.
const unorderedItemOf = (line: string) => /^(\s*)[-+*]\s+(.+)$/.exec(line);
const orderedItemOf = (line: string) => /^(\s*)\d+[.)]\s+(.+)$/.exec(line);

/** Parse headings + nested lists into an outline. Headings become entries in
 *  document order; list runs after a heading attach to it, lists before any
 *  heading become a leading `{kind:'items'}` entry.
 *
 *  Nesting uses an indentation stack: indent greater than the stack top nests
 *  under the previous item, equal is a sibling, smaller pops. A tab expands to
 *  two spaces before measuring, so one tab = one 2-space level. Indent jumps
 *  deeper than one level clamp to stack depth + 1 (the stack can only grow by
 *  one entry per line, so no level is ever skipped).
 *
 *  The first paragraph line run directly after a heading or item (any line
 *  that is not a list/heading/fence/quote/rule) becomes that entry's
 *  `description`; later paragraphs are ignored. Code fences, quotes, and
 *  rules are skipped entirely. */
export function parseMarkdownOutline(markdown: string): OutlineEntry[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const entries: OutlineEntry[] = [];
  /** Entry that currently receives list runs (last heading, or the leading
   *  items entry created on demand). */
  let current: OutlineEntry | null = null;
  /** Heading/item still eligible for a description paragraph. */
  let target: { description?: string } | null = null;
  let stack: { indent: number; item: OutlineItem }[] = [];
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    if (paragraph.length && target && target.description === undefined) {
      target.description = paragraph.join(' ');
    }
    paragraph = [];
  };
  const addItem = (indent: number, text: string) => {
    if (!current) {
      current = { kind: 'items', items: [] };
      entries.push(current);
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const item: OutlineItem = { text, children: [] };
    if (stack.length) stack[stack.length - 1].item.children.push(item);
    else current.items.push(item);
    stack.push({ indent, item });
    target = item;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (fenceOf(line)) {
      flushParagraph();
      index += 1;
      while (index < lines.length && !fenceOf(lines[index])) index += 1;
      if (index < lines.length) index += 1;
      continue;
    }
    if (!line.trim()) { flushParagraph(); index += 1; continue; }
    const heading = headingOf(line);
    if (heading) {
      flushParagraph();
      const entry: OutlineEntry = { kind: 'heading', level: heading[1].length, text: heading[2], items: [] };
      entries.push(entry);
      current = entry;
      stack = [];
      target = entry;
      index += 1;
      continue;
    }
    if (isRule(line) || quoteOf(line)) { flushParagraph(); index += 1; continue; }
    const listed = unorderedItemOf(line) ?? orderedItemOf(line);
    if (listed) {
      flushParagraph();
      addItem(listed[1].replace(/\t/g, '  ').length, listed[2].trim());
      index += 1;
      continue;
    }
    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();
  return entries;
}
