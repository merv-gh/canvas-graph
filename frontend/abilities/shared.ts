import type { AbilityDef, ActionDef, NonEmptyArray } from '../types';

export const action = <T,>(def: Omit<ActionDef<T>, 'ui'> & Partial<Pick<ActionDef<T>, 'ui'>>): ActionDef<T> =>
  ({ ui: [], ...def });
export const ability = <T,>(id: string, actions: NonEmptyArray<ActionDef<T>>): AbilityDef<T> => ({ id, actions });
