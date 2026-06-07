import type { AbilityDef, ActionDef, NonEmptyArray } from '../types';

export const action = <T,>(def: ActionDef<T>) => def;
export const ability = <T,>(id: string, actions: NonEmptyArray<ActionDef<T>>): AbilityDef<T> => ({ id, actions });
