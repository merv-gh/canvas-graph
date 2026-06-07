import { itemIdFrom, type Registry } from '../core';
import type { CommandSource } from '../types';

export function registerDomain(system: Registry) {
  system('domain', ({ contexts, graphs, selection, contribute }) => {
    let count = 1;
    contribute({ surface: 'top', command: 'editing.node.create', kind: 'button', text: '+ Node', order: 10 });
    contribute({ surface: 'top', command: 'graph.create', kind: 'button', text: '+ Graph', order: 20 });
    const graphId = (source: CommandSource) => itemIdFrom(source.target) || graphs.current.id;
    const nextGraphId = () => graphs.all().find(graph => graph.id !== graphs.current.id)?.id ?? `g${graphs.all().length + 1}`;

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
        event: 'graph.edge.create',
        group: 'edge',
        available: source => !!itemIdFrom(source?.target) || !!selection.selected(),
        payload: source => {
          const id = itemIdFrom(source.target) || selection.selected() || '';
          return { From: id, To: id };
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
