import {
  createPublicClient,
  createWalletClient,
  custom,
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
import { CHAIN_ID, IS_LOCAL, RPC_URL, chain } from './config';

export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { batch: { wait: 16 } }),
  pollingInterval: 500,
});

export type WalletMode = 'burner' | 'injected';

export interface Wallet {
  mode: WalletMode;
  address: Address;
  /** LocalAccount for the burner, plain address for JSON-RPC (injected) accounts. */
  account: Account | Address;
  client: WalletClient;
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
  return m === 'burner' || m === 'injected' ? m : null;
};
export const forgetMode = (): void => storageSet(MODE_KEY, null);
export const hasInjected = (): boolean => typeof window !== 'undefined' && !!window.ethereum;

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
  if (!IS_LOCAL) throw new Error('Burner-кошелёк доступен только в локальной сети anvil (31337)');
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

export async function connectInjected(): Promise<Wallet> {
  const eth = window.ethereum;
  if (!eth) throw new Error('Кошелёк в браузере не найден (window.ethereum)');
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as Address[];
  if (!accounts?.length) throw new Error('Кошелёк не вернул адрес');
  const current = Number(await eth.request({ method: 'eth_chainId' }));
  if (current !== CHAIN_ID) {
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: numberToHex(CHAIN_ID) }] });
    } catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: numberToHex(CHAIN_ID),
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [RPC_URL],
          },
        ],
      });
    }
  }
  storageSet(MODE_KEY, 'injected');
  const address = accounts[0];
  const client = createWalletClient({ account: address, chain, transport: custom(eth) });
  return { mode: 'injected', address, account: address, client };
}
