import { itemIdFrom, itemRefFrom, type Registry } from '../core';
import type { CommandSource, EdgeCreateDraft } from '../types';

export function registerDomain(system: Registry) {
  system('domain', ({ contexts, graphs, selection, contribute }) => {
    let count = 1;
    contribute({ surface: 'top', command: 'editing.node.create', kind: 'button', text: '+ Node', order: 10 });
    contribute({ surface: 'top', command: 'graph.edge.create', kind: 'button', text: '+ Edge', order: 15 });
    contribute({ surface: 'top', command: 'graph.create', kind: 'button', text: '+ Graph', order: 20 });
    const graphId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.id;
    const nextGraphId = () => graphs.all().find(graph => graph.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;
    const nodeRef = (source: CommandSource) => {
      const ref = itemRefFrom(source.target);
      return ref?.kind === 'node' ? ref.id : '';
    };
    const nodeOptions = () => graphs.current.nodes().map(node => ({ value: node.id, label: `${node.id} · ${node.Label.text}` }));
    const edgeSeed = (source: CommandSource): EdgeCreateDraft => {
      const ids = graphs.current.nodes().map(node => node.id);
      const from = nodeRef(source) || selection.selected() || ids[0] || '';
      const others = ids.filter(id => id !== from);
      return { From: from, To: ids.length === 2 ? others[0] ?? '' : '' };
    };
    const edgeFormValues = (payload: unknown) => {
      const seed = payload as EdgeCreateDraft | undefined;
      return { From: seed?.From ?? '', To: seed?.To ?? '' };
    };
    const edgeFormError = (values: Record<string, string>) => {
      if (graphs.current.nodes().length < 2) return 'Create at least two nodes before creating an edge.';
      if (!values.From || !values.To) return 'Choose source and target nodes.';
      if (values.From === values.To) return 'Source and target must be different nodes.';
      if (!graphs.current.getNode(values.From)) return `Unknown source node "${values.From}".`;
      if (!graphs.current.getNode(values.To)) return `Unknown target node "${values.To}".`;
      return undefined;
    };

    contexts.commands.register([
      {
        id: 'editing.node.create',
        label: 'Create node',
        event: 'editing.node.create',
        group: 'editing',
        shortcut: 'A',
        input: { on: 'keydown', key: 'a', prevent: true },
        payload: () => ({ Label: { text: `Node ${count++}` } }),
      },
      {
        id: 'graph.create',
        label: 'Create graph',
        event: 'graph.create',
        group: 'graph',
        shortcut: 'N',
        input: { on: 'keydown', key: 'n', prevent: true },
      },
      {
        id: 'graph.switch.next',
        label: 'Switch graph',
        event: 'graph.switch',
        group: 'graph',
        shortcut: 'G',
        input: { on: 'keydown', key: 'g', prevent: true },
        payload: () => ({ id: nextGraphId() }),
      },
      {
        id: 'graph.switch.item',
        label: 'Switch graph item',
        event: 'graph.switch',
        group: 'graph',
        hidden: true,
        payload: source => ({ id: graphId(source) }),
      },
      {
        id: 'graph.node.delete.selected',
        label: 'Delete node',
        event: 'graph.node.delete',
        group: 'graph',
        shortcut: 'Delete',
        input: { on: 'keydown', key: 'Delete', prevent: true },
        available: source => !!itemIdFrom(source?.target) || !!selection.selected(),
        payload: source => ({ id: itemIdFrom(source.target) || selection.selected() || '' }),
      },
      {
        id: 'graph.delete.current',
        label: 'Delete graph',
        event: 'graph.delete',
        group: 'graph',
        available: source => graphs.all().length > 1 && (!!itemIdFrom(source?.target) || !!graphs.current.id),
        payload: source => ({ id: graphId(source) }),
      },
      {
        id: 'graph.edge.create',
        label: 'Create edge',
        event: 'editing.edge.create',
        group: 'edge',
        shortcut: 'E',
        input: { on: 'keydown', key: 'e', prevent: true },
        payload: edgeSeed,
        form: {
          title: 'Create edge',
          submitLabel: 'Create edge',
          fields: [
            { id: 'From', label: 'Source node', placeholder: 'e1', options: nodeOptions },
            { id: 'To', label: 'Target node', placeholder: 'e2', options: nodeOptions },
          ],
          seed: edgeFormValues,
          shouldOpen: () => true,
          validate: edgeFormError,
          payload: values => ({ From: values.From, To: values.To }),
        },
      },
      {
        id: 'graph.edge.delete',
        label: 'Delete edge',
        event: 'graph.edge.delete',
        group: 'edge',
        available: source => !!itemIdFrom(source?.target),
        payload: source => ({ id: itemIdFrom(source.target) }),
      },
    ]);
  });
}
