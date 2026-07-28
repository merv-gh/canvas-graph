import type { Registry } from '../core';
import type { GraphSnapshot } from '../model';
import {
  decodeGraph,
  decodeShareView,
  encodeGraph,
  encodeShareView,
  jsonToSnapshot,
  looksLikeMarkdownOutline,
  looksLikeMermaid,
  markdownOutlineToSnapshot,
  mermaidToSnapshot,
  shareUrlTooLarge,
  type ImportFormat,
} from './share-codecs';

export {
  decodeGraph,
  decodeShareView,
  encodeGraph,
  encodeShareView,
  mermaidToSnapshot,
  SHARE_URL_LIMIT,
  shareUrlTooLarge,
} from './share-codecs';

declare module '../types' {
  interface CustomEvents {
    /** Copy a share link (`?g=`) for the current graph to the clipboard. */
    'graph.share.copy': void;
    'graph.share.clipboard': { url: string };
    'graph.share.context.toggle': { checked: boolean; panel?: HTMLElement };
    'graph.shared': { url: string };
    /** Import a mermaid flowchart from a string (raw source, a mermaid.live
     *  link, or an http(s) URL) — the paste/`?in=` entry point. */
    'graph.import.mermaid': { source: string };
    /** Import a Markdown outline (headings + nested lists) from raw text. */
    'graph.import.markdown': { source: string };
    'graph.import.confirm': void;
    'graph.import.cancel': void;
    /** Read the clipboard and import it as mermaid (palette action). */
    'graph.import.paste': void;
    /** Preview Mermaid entered in the import dialog. */
    'graph.import.submit': { source: string };
    'graph.import.file.choose': { input?: HTMLInputElement };
    'graph.import.file.read': { file?: File; textarea?: HTMLTextAreaElement };
  }
}
export function registerShare(system: Registry) {
  system('share', ({ on, emit, contexts, graphs, selection, contribute }) => {
    let pendingImport: { snapshot: GraphSnapshot; format: ImportFormat; tidy: boolean } | null = null;
    contexts.commands.register([
      { id: 'graph.share.copy', label: 'Share current graph', group: 'graph' },
      {
        id: 'graph.share.clipboard', label: 'Copy share link', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-share-copy]' },
        payload: ({ target }) => ({
          url: (target?.closest('.share-link-panel')?.querySelector('[data-share-url]') as HTMLInputElement | null)?.value ?? '',
        }),
      },
      {
        id: 'graph.share.context.toggle', label: 'Include current view in share link', group: 'graph', hidden: true,
        input: { on: 'change', selector: '[data-share-context]' },
        payload: ({ target }) => ({
          checked: (target as HTMLInputElement).checked,
          panel: target?.closest<HTMLElement>('.share-link-panel') ?? undefined,
        }),
      },
      { id: 'graph.import.paste', label: 'Import graph from clipboard', group: 'graph' },
      {
        id: 'graph.import.submit', label: 'Preview Mermaid import', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-import-submit]' },
        payload: ({ target }) => ({
          source: (target?.closest('.import-source')?.querySelector('[data-import-source]') as HTMLTextAreaElement | null)?.value ?? '',
        }),
      },
      {
        id: 'graph.import.confirm', label: 'Replace graph with import', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-import-confirm]' },
      },
      {
        id: 'graph.import.cancel', label: 'Cancel graph import', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-import-cancel]' },
      },
      {
        id: 'graph.import.file.choose', label: 'Choose Markdown file', group: 'graph', hidden: true,
        input: { on: 'click', selector: '[data-import-file-choose]' },
        payload: ({ target }) => ({
          input: target?.closest('.import-source')?.querySelector<HTMLInputElement>('[data-import-file]') ?? undefined,
        }),
      },
      {
        id: 'graph.import.file.read', label: 'Read Markdown file', group: 'graph', hidden: true,
        input: { on: 'change', selector: '[data-import-file]' },
        payload: ({ target }) => {
          const input = target as HTMLInputElement | null;
          return {
            file: input?.files?.[0],
            textarea: input?.closest('.import-source')?.querySelector<HTMLTextAreaElement>('[data-import-source]') ?? undefined,
          };
        },
      },
      {
        id: 'graph.import.mermaid.paste-event',
        label: 'Import pasted mermaid graph',
        event: 'graph.import.mermaid',
        group: 'graph',
        hidden: true,
        input: {
          on: 'paste',
          global: true,
          prevent: true,
          when: event => {
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))) return false;
            const text = (event as ClipboardEvent).clipboardData?.getData('text') ?? '';
            return !!text && looksLikeMermaid(text);
          },
        },
        payload: ({ event }) => ({ source: (event as ClipboardEvent).clipboardData?.getData('text') ?? '' }),
      },
    ]);

    // `?g=` carries real positions → keep them. Mermaid has none → tidy first.
    const importSnapshot = (snapshot: GraphSnapshot, tidy = false, fit = true) => {
      emit('graph.import.snapshot', snapshot);
      if (tidy) emit('layout.apply.tidy');
      if (fit) emit('view.fit.all');
    };

    const applyShareUrl = (panel: HTMLElement, url: string) => {
      const tooLarge = shareUrlTooLarge(url);
      const intro = panel.querySelector<HTMLElement>('[data-share-intro]');
      const input = panel.querySelector<HTMLInputElement>('[data-share-url]');
      const copy = panel.querySelector<HTMLButtonElement>('[data-share-copy]');
      const meta = panel.querySelector<HTMLElement>('.share-size');
      const fallback = panel.querySelector<HTMLElement>('[data-share-fallback]');
      if (intro) {
        intro.textContent = tooLarge
          ? 'This snapshot is too large for a reliable browser link. Export a file instead.'
          : 'Portable snapshot link. Anyone with this URL can open an editable copy; changes do not sync back.';
        intro.classList.toggle('share-size-warning', tooLarge);
      }
      panel.toggleAttribute('data-share-too-large', tooLarge);
      if (input) input.value = url;
      if (copy) copy.disabled = tooLarge;
      if (meta) meta.textContent = `${url.length.toLocaleString()} characters · graph data is embedded in the URL`;
      if (fallback) fallback.hidden = !tooLarge;
    };

    const shareBody = (url: string, viewState: string) => () => {
      const panel = document.createElement('section');
      panel.className = 'share-link-panel';
      panel.dataset.shareView = viewState;
      const intro = document.createElement('p');
      intro.dataset.shareIntro = '';
      const contextOption = document.createElement('label');
      contextOption.className = 'share-context-option';
      const contextCopy = document.createElement('span');
      const contextTitle = document.createElement('strong');
      contextTitle.textContent = 'Open at this view';
      const contextHelp = document.createElement('small');
      contextHelp.textContent = 'Include viewport, zoom, and selection';
      contextCopy.append(contextTitle, contextHelp);
      const contextSwitch = document.createElement('input');
      contextSwitch.type = 'checkbox';
      contextSwitch.dataset.shareContext = '';
      contextSwitch.setAttribute('role', 'switch');
      contextSwitch.setAttribute('aria-label', 'Include viewport, zoom, and selection');
      contextOption.append(contextCopy, contextSwitch);
      const field = document.createElement('div');
      field.className = 'share-link-field';
      const input = document.createElement('input');
      input.readOnly = true;
      input.value = url;
      input.dataset.shareUrl = '';
      input.setAttribute('aria-label', 'Share link');
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'primary share-copy';
      copy.dataset.shareCopy = '';
      copy.dataset.command = 'graph.share.clipboard';
      copy.setAttribute('aria-label', 'Copy share link');
      copy.textContent = '⧉ Copy';
      field.append(input, copy);
      const meta = document.createElement('small');
      meta.className = 'share-size';
      const fallback = document.createElement('button');
      fallback.type = 'button';
      fallback.className = 'primary';
      fallback.dataset.command = 'graph.export.json';
      fallback.dataset.shareFallback = '';
      fallback.textContent = 'Export a file instead';
      panel.append(intro, contextOption, field, meta, fallback);
      applyShareUrl(panel, url);
      return panel;
    };

    const importPreviewBody = (snapshot: GraphSnapshot, format: ImportFormat) => () => {
      const panel = document.createElement('section');
      panel.className = 'import-preview';
      const summary = document.createElement('p');
      const nodes = `${snapshot.nodes.length} node${snapshot.nodes.length === 1 ? '' : 's'}`;
      const edges = `${snapshot.edges.length} edge${snapshot.edges.length === 1 ? '' : 's'}`;
      summary.textContent = `${format}: ${nodes} and ${edges} are ready to import.`;
      const warning = document.createElement('p');
      warning.className = 'import-warning';
      warning.textContent = 'This replaces the current graph. You can undo after importing.';
      const actions = document.createElement('div');
      actions.className = 'import-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.command = 'graph.import.cancel';
      cancel.dataset.importCancel = '';
      cancel.textContent = 'Keep current graph';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'primary import-confirm';
      confirm.dataset.command = 'graph.import.confirm';
      confirm.dataset.importConfirm = '';
      confirm.textContent = 'Replace graph';
      actions.append(cancel, confirm);
      panel.append(summary, warning, actions);
      return panel;
    };

    const importSourceBody = (source = '') => () => {
      const panel = document.createElement('section');
      panel.className = 'import-source';
      const intro = document.createElement('p');
      intro.textContent = 'Paste Canvas Graph JSON, Mermaid flowchart source, a mermaid.live link, or a Markdown outline (headings + nested lists). You will review changes before replacement.';
      const textarea = document.createElement('textarea');
      textarea.dataset.importSource = '';
      textarea.setAttribute('aria-label', 'Graph JSON or Mermaid source');
      textarea.placeholder = 'Paste exported JSON or: flowchart LR\n  A[Draft] --> B[Published]';
      textarea.value = source;
      textarea.autofocus = true;
      const actions = document.createElement('div');
      actions.className = 'import-actions';
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'primary import-confirm';
      preview.dataset.command = 'graph.import.submit';
      preview.dataset.importSubmit = '';
      preview.textContent = 'Preview import';
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = '.md,.markdown,.txt';
      file.hidden = true;
      file.dataset.importFile = '';
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.textContent = 'Choose .md file';
      choose.dataset.command = 'graph.import.file.choose';
      choose.dataset.importFileChoose = '';
      actions.append(preview, choose, file);
      panel.append(intro, textarea, actions);
      return panel;
    };

    on('graph.share.copy', () => {
      void (async () => {
        const encoded = await encodeGraph(graphs.current.snapshot());
        const url = new URL(location.href);
        url.hash = '';
        url.searchParams.delete('in');
        url.searchParams.delete('demo');
        url.searchParams.delete('view');
        url.searchParams.set('g', encoded);
        emit('graph.shared', { url: url.toString() });
        emit('modal.open', {
          title: 'Share graph',
          visual: 'properties',
          body: shareBody(url.toString(), encodeShareView(contexts.view.get(), selection.selected())),
        });
      })();
    });
    on('graph.share.context.toggle', ({ checked, panel }) => {
      if (!panel) return;
      const input = panel.querySelector<HTMLInputElement>('[data-share-url]');
      if (!input) return;
      const url = new URL(input.value);
      if (checked && panel.dataset.shareView) url.searchParams.set('view', panel.dataset.shareView);
      else url.searchParams.delete('view');
      applyShareUrl(panel, url.toString());
      emit('graph.shared', { url: url.toString() });
    });
    on('graph.import.file.choose', ({ input }) => input?.click());
    on('graph.import.file.read', ({ file, textarea }) => {
      if (!file || !textarea) return;
      const reader = new FileReader();
      reader.onload = () => { textarea.value = String(reader.result ?? ''); };
      reader.readAsText(file);
    });
    on('graph.share.clipboard', ({ url }) => {
      if (!url) return;
      void navigator.clipboard?.writeText?.(url).then(
        () => emit('app.notice', { message: 'Share link copied.' }),
        () => emit('app.notice', { message: 'Select the link and copy it manually.', level: 'warn' }),
      );
    });

    on('graph.import.mermaid', ({ source }) => {
      void (async () => {
        const snapshot = await mermaidToSnapshot(source);
        if (!snapshot) {
          emit('app.notice', { message: 'Mermaid has incomplete or unsupported syntax. Nothing was changed.', level: 'warn' });
          return;
        }
        pendingImport = { snapshot, format: 'Mermaid', tidy: true };
        emit('modal.open', { title: 'Review Mermaid import', visual: 'properties', body: importPreviewBody(snapshot, 'Mermaid') });
      })();
    });
    on('graph.import.markdown', ({ source }) => {
      const { snapshot, counts } = markdownOutlineToSnapshot(source);
      if (!counts.nodes) {
        emit('app.notice', { message: 'No headings or list items found in the Markdown outline. Nothing was changed.', level: 'warn' });
        return;
      }
      pendingImport = { snapshot, format: 'Markdown outline', tidy: false };
      emit('modal.open', { title: 'Review Markdown outline import', visual: 'properties', body: importPreviewBody(snapshot, 'Markdown outline') });
    });
    on('graph.import.submit', ({ source }) => {
      if (!source.trim()) {
        emit('app.notice', { message: 'Paste graph JSON or Mermaid before previewing.', level: 'warn' });
        return;
      }
      if (source.trimStart().startsWith('{')) {
        const snapshot = jsonToSnapshot(source);
        if (!snapshot) {
          emit('app.notice', { message: 'JSON is not a valid Canvas Graph export. Nothing was changed.', level: 'warn' });
          return;
        }
        pendingImport = { snapshot, format: 'JSON', tidy: false };
        emit('modal.open', { title: 'Review JSON import', visual: 'properties', body: importPreviewBody(snapshot, 'JSON') });
        return;
      }
      if (looksLikeMermaid(source)) {
        emit('graph.import.mermaid', { source });
        return;
      }
      if (looksLikeMarkdownOutline(source)) {
        emit('graph.import.markdown', { source });
        return;
      }
      emit('graph.import.mermaid', { source });
    });
    on('graph.import.confirm', () => {
      const pending = pendingImport;
      if (!pending) return;
      pendingImport = null;
      importSnapshot(pending.snapshot, pending.tidy);
      emit('modal.close');
      emit('app.notice', { message: `Imported ${pending.snapshot.nodes.length} nodes from ${pending.format}.` });
    });
    on('graph.import.cancel', () => { pendingImport = null; emit('modal.close'); });
    on('modal.closed', () => { pendingImport = null; });

    on('graph.import.paste', () => {
      // Open immediately: clipboard permission prompts may stay pending until
      // user interaction. The manual path must never wait behind that promise.
      emit('modal.open', { title: 'Import graph', visual: 'properties', body: importSourceBody() });
      const read = navigator.clipboard?.readText?.();
      if (read) void read.then(text => {
        if (!text) return;
        const textarea = contexts.places.el('modal')?.querySelector<HTMLTextAreaElement>('[data-import-source]');
        if (textarea && !textarea.value) textarea.value = text;
      }).catch(() => undefined);
    });

    const bootFromUrl = () => {
      const params = new URLSearchParams(location.search);
      const g = params.get('g');
      const incoming = params.get('in');
      if (g) {
        void decodeGraph(g).then(snapshot => {
          const sharedView = decodeShareView(params.get('view'));
          if (snapshot) {
            importSnapshot(snapshot, false, !sharedView);
            if (sharedView) {
              contexts.view.set(sharedView.view);
              emit('view.changed', contexts.view.get());
              if (sharedView.selected && graphs.current.getItem(sharedView.selected)) {
                emit('selection.item.select', sharedView.selected);
              }
            }
          }
          else emit('app.notice', { message: 'Share link graph could not be decoded.', level: 'warn' });
        });
        return;
      }
      if (incoming) emit('graph.import.mermaid', { source: incoming });
    };

    on('app.start', bootFromUrl);
    contribute({ surface: 'top', command: 'graph.import.paste', kind: 'button', icon: 'import', text: 'Import', order: 23, group: 'overflow' });
    contribute({ surface: 'top', command: 'graph.share.copy', kind: 'button', icon: 'share', text: 'Share', order: 24, group: 'overflow' });
  }, { requires: ['graph', 'modal'] });
}
