import type { ItemRef, Position } from '../types';
import { sameItemRef } from './item-ref';

export type ItemTarget = { ref: ItemRef; label: string; anchor: Position };
export type ItemTargetProvider = () => ItemTarget[];

export function itemTargetsContext() {
  const providers = new Map<string, ItemTargetProvider>();
  const all = () => [...providers.values()].flatMap(provider => provider());
  return {
    register(source: string, provider: ItemTargetProvider) {
      providers.set(source, provider);
      return () => providers.delete(source);
    },
    unregisterSource(source: string) {
      providers.delete(source);
    },
    all,
    get(ref: ItemRef) {
      return all().find(target => sameItemRef(target.ref, ref));
    },
    anchor(ref: ItemRef) {
      return all().find(target => sameItemRef(target.ref, ref))?.anchor ?? null;
    },
  };
}
