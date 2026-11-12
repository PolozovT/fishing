import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  numberToHex,
  parseEther,
  type Account,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { IS_LOCAL, RPC_URL, chain } from './config';

export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { batch: { wait: 16 } }),
  pollingInterval: 500,
});

export type WalletMode = 'burner' | 'fluent';

export interface Wallet {
  mode: WalletMode;
  address: Address;
  /** LocalAccount for the burner; the account's address for Fluent Connect. */
  account: Account | Address;
  /** Signs and sends for the burner. Fluent Connect sends through the widget instead (see tx.ts). */
  client?: WalletClient;
  /** "smart" for a Fluent ID, "eoa" for an External wallet connected through Fluent Connect. */
  kind?: 'smart' | 'eoa';
}

/** Wallet record for an account connected through the Fluent Connect widget. */
export function fluentWallet(address: Address, kind?: 'smart' | 'eoa'): Wallet {
  return { mode: 'fluent', address, account: address, kind };
}

const BURNER_KEY = 'onchain-fishing:burner-key';
const MODE_KEY = 'onchain-fishing:wallet-mode';

function storageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function storageSet(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: the burner just won't persist */
  }
}

export const savedMode = (): WalletMode | null => {
  const m = storageGet(MODE_KEY);
  return m === 'burner' ? m : null;
};
export const forgetMode = (): void => storageSet(MODE_KEY, null);

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/**
 * Local dev burner: a random key kept in localStorage, funded via anvil's `anvil_setBalance`.
 * Only for chainId 31337 — never use with real funds.
 */
export async function connectBurner(): Promise<Wallet> {
  if (!IS_LOCAL) throw new Error('Burner wallet is only available on the local anvil network (31337)');
  let key = storageGet(BURNER_KEY) as `0x${string}` | null;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    key = generatePrivateKey();
    storageSet(BURNER_KEY, key);
  }
  const account = privateKeyToAccount(key);
  await fundBurner(account.address);
  storageSet(MODE_KEY, 'burner');
  const client = createWalletClient({ account, chain, transport: http(RPC_URL) });
  return { mode: 'burner', address: account.address, account, client };
}

export async function fundBurner(address: Address, minEth = '1'): Promise<void> {
  const bal = await publicClient.getBalance({ address });
  if (bal >= parseEther(minEth)) return;
  await rpc('anvil_setBalance', [address, numberToHex(parseEther('10'))]);
  console.info(`[burner] funded ${address} with 10 ETH (was ${formatEther(bal)})`);
}

/** Replace the burner key (old one is lost — only fine on a local chain). */
export function resetBurner(): void {
  storageSet(BURNER_KEY, null);
}
