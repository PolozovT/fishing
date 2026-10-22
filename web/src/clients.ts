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
import { CHAIN_ID, EXPLORER_URL, IS_LOCAL, RPC_URL, chain } from './config';

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

type RpcError = { code?: number; message?: string; data?: { originalError?: { code?: number } } };

const errCode = (e: unknown): number | undefined => {
  const r = e as RpcError | null;
  return r?.data?.originalError?.code ?? r?.code; // MetaMask mobile wraps 4902 inside -32603
};

/** Runs one wallet request and turns a failure into a message that says which step failed. */
async function step<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = errCode(e);
    if (code === 4001) throw new Error(`Rejected in wallet: ${what}`);
    if (code === -32002) throw new Error(`Request "${what}" is already pending in the wallet — open the extension`);
    const msg = (e as RpcError | null)?.message ?? String(e);
    throw new Error(`${what}: ${msg}`);
  }
}

export async function connectInjected(): Promise<Wallet> {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found (window.ethereum)');
  const accounts = (await step('account access', () =>
    eth.request({ method: 'eth_requestAccounts' }),
  )) as Address[];
  if (!accounts?.length) throw new Error('Wallet returned no address');
  const current = Number(await eth.request({ method: 'eth_chainId' }));
  if (current !== CHAIN_ID) {
    const hexId = numberToHex(CHAIN_ID);
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (e) {
      if (errCode(e) === 4001) throw new Error(`Wallet rejected switching to network ${chain.name} (chainId ${CHAIN_ID})`);
      // 4902 = unknown chain; some wallets report other codes for the same thing, so try adding it either way
      await step(`adding network ${chain.name} (chainId ${CHAIN_ID}, RPC ${RPC_URL})`, () =>
        eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexId,
              chainName: chain.name,
              nativeCurrency: chain.nativeCurrency,
              rpcUrls: [RPC_URL],
              ...(EXPLORER_URL ? { blockExplorerUrls: [EXPLORER_URL] } : {}),
            },
          ],
        }),
      );
      const now = Number(await eth.request({ method: 'eth_chainId' }));
      if (now !== CHAIN_ID) {
        await step(`switching to network ${chain.name}`, () =>
          eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] }),
        );
      }
    }
  }
  const address = accounts[0];
  // On anvil the wallet's account starts with 0 ETH — top it up so it can pay gas.
  if (IS_LOCAL) await fundBurner(address);
  storageSet(MODE_KEY, 'injected');
  const client = createWalletClient({ account: address, chain, transport: custom(eth) });
  return { mode: 'injected', address, account: address, client };
}
