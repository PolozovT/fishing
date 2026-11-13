/** Shared app state outside the game save: the connected account and a tiny pub/sub for re-rendering. */
import type { Wallet } from './clients';

export interface State {
  wallet: Wallet | null;
  /** Fluent Connect widget status ('off' when it is not configured). */
  fluentStatus: 'off' | 'restoring' | 'connecting' | 'connected' | 'disconnected';
  connecting: boolean;
}

export const state: State = { wallet: null, fluentStatus: 'off', connecting: false };

const listeners = new Set<() => void>();
export const subscribe = (f: () => void): void => void listeners.add(f);
let emitQueued = false;
/** Re-renders everything once, after the current task. */
export function emit(): void {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    emitQueued = false;
    listeners.forEach((f) => f());
  });
}
