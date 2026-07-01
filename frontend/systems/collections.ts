import { collectionCreateCommand, type AppCollectionDef, type Registry } from '../core';
import type { SystemAffordance } from '../types';

/** Materialise the commands and toolbar buttons declared by each CollectionDef.
 *  Adding a new collection in model.ts requires zero edits in systems/ — the create
 *  command, delete command, and toolbar button all derive from the collection's
 *  declaration. */
export function registerCollections(system: Registry) {
  system('collections', ctx => {
    (ctx.model.collections() as unknown as AppCollectionDef<unknown>[]).forEach(coll => {
      if (coll.toolbar === false) return;
      const button: SystemAffordance = {
        surface: coll.toolbar?.surface ?? 'top',
        command: collectionCreateCommand(coll),
        kind: 'button',
        text: coll.toolbar?.text ?? `+ ${coll.entity?.label ?? coll.kind}`,
        order: coll.toolbar?.order,
        // Node/edge creation belongs to the "graph editing" cluster; the graph
        // (document) switcher stays loose.
        group: coll.kind === 'graph' ? undefined : 'edit',
      };
      ctx.contribute(button);
    });
  }, { requires: ['graph'] });
}
