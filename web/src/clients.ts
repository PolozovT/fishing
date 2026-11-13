import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { RPC_URL, chain } from './config';

export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { batch: { wait: 16 } }),
  pollingInterval: 500,
});

/** The player's account, connected through the Fluent Connect widget (which also signs and sends, see tx.ts). */
export interface Wallet {
  address: Address;
  /** "smart" for a Fluent ID, "eoa" for an External wallet connected through Fluent Connect. */
  kind?: 'smart' | 'eoa';
}

export function fluentWallet(address: Address, kind?: 'smart' | 'eoa'): Wallet {
  return { address, kind };
}
