// store เล็กๆ ใช้กับ useSyncExternalStore
import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T extends object>(init: T): Store<T> {
  let state = init;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = {...state, ...p};
      subs.forEach(f => f());
    },
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

export function useStore<T extends object>(s: Store<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
