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
import { findWallet, listWallets, type Eip1193Provider } from './wallets';

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
  /** EIP-1193 provider of the browser wallet (injected mode only), for account/chain change events. */
  provider?: Eip1193Provider;
}

const BURNER_KEY = 'onchain-fishing:burner-key';
const MODE_KEY = 'onchain-fishing:wallet-mode';
const WALLET_KEY = 'onchain-fishing:wallet-id';

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
export const hasInjected = (): boolean => typeof window !== 'undefined' && listWallets().length > 0;
export const savedWalletId = (): string | null => storageGet(WALLET_KEY);

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

export async function connectInjected(walletId?: string): Promise<Wallet> {
  const picked = findWallet(walletId ?? savedWalletId());
  if (!picked) throw new Error('Browser wallet not found — is the extension enabled?');
  const eth = picked.provider;
  let accounts: Address[];
  try {
    accounts = (await eth.request({ method: 'eth_requestAccounts' })) as Address[];
  } catch (e) {
    if (errCode(e) !== 4001) return step('account access', () => Promise.reject(e));
    const other = listWallets().filter((w) => w.id !== picked.id).map((w) => w.name);
    const hint = other.length ? ` or connect with ${other.join(' / ')} instead` : '';
    throw new Error(
      `${picked.name} rejected account access. If no popup appeared, the wallet is probably locked — unlock it${hint}.`,
      { cause: e },
    );
  }
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
  storageSet(WALLET_KEY, picked.id);
  const client = createWalletClient({ account: address, chain, transport: custom(eth) });
  return { mode: 'injected', address, account: address, client, provider: eth };
}
