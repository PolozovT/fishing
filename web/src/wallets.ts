/**
 * Browser wallet discovery via EIP-6963. With several extensions installed (MetaMask, Phantom, Rabby, …) they all
 * fight over `window.ethereum`, and the winner may not be the wallet the player wants — e.g. a locked Phantom
 * instantly rejects `eth_requestAccounts`. EIP-6963 lets every wallet announce itself, so the player can pick one.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

export interface WalletOption {
  id: string; // EIP-6963 rdns, or "injected" for the legacy window.ethereum fallback
  name: string;
  icon?: string; // data URI supplied by the wallet itself
  provider: Eip1193Provider;
}

interface AnnounceDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

const found = new Map<string, WalletOption>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = (e as CustomEvent<AnnounceDetail>).detail;
    if (!d?.info?.rdns || !d.provider) return;
    found.set(d.info.rdns, { id: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider });
    notify();
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Wallets found so far; falls back to plain window.ethereum for wallets without EIP-6963 support. */
export function listWallets(): WalletOption[] {
  if (found.size) return [...found.values()];
  return window.ethereum ? [{ id: 'injected', name: 'Browser wallet', provider: window.ethereum }] : [];
}

export function findWallet(id: string | null): WalletOption | undefined {
  const all = listWallets();
  return all.find((w) => w.id === id) ?? (id ? undefined : all[0]);
}

export function onWalletsChanged(fn: () => void): void {
  listeners.add(fn);
}
