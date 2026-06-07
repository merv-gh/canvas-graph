import type { AppCollectionDef, CollectionCommandsApi, Registry } from '../core';
import type { SystemAffordance } from '../types';

/** Materialise the commands and toolbar buttons declared by each CollectionDef.
 *  Adding a new collection in model.ts requires zero edits in systems/ — the create
 *  command, delete command, and toolbar button all derive from the collection's
 *  declaration. */
export function registerCollections(system: Registry) {
  system('collections', ctx => {
    const api: CollectionCommandsApi = {
      graphs: ctx.graphs,
      selection: ctx.selection,
      view: ctx.contexts.view,
      contexts: ctx.contexts,
    };
    (ctx.model.collections() as unknown as AppCollectionDef<unknown>[]).forEach(coll => {
      const specs = coll.commands?.(api) ?? [];
      ctx.contexts.commands.register(specs);
      if (coll.toolbar === false) return;
      const button: SystemAffordance = {
        surface: coll.toolbar?.surface ?? 'top',
        command: coll.crud.create,
        kind: 'button',
        text: coll.toolbar?.text ?? `+ ${coll.entity?.label ?? coll.label.replace(/s$/, '')}`,
        order: coll.toolbar?.order,
      };
      ctx.contribute(button);
    });
  });
}
