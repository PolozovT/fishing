import { defineChain, type Chain } from 'viem';
import { deployments, type Deployment } from './generated/deployments';

/** Networks the client knows by name. Pick one with VITE_CHAIN_ID (see .env.fluent-testnet). */
const KNOWN: Record<number, { name: string; rpc: string; explorer?: string }> = {
  31337: { name: 'Anvil (local)', rpc: 'http://127.0.0.1:8545' },
  20994: { name: 'Fluent Testnet', rpc: 'https://rpc.testnet.fluent.xyz', explorer: 'https://testnet.fluentscan.xyz' },
  25363: { name: 'Fluent', rpc: 'https://rpc.fluent.xyz', explorer: 'https://fluentscan.xyz' },
};

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
const known = KNOWN[CHAIN_ID];
export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? known?.rpc ?? 'http://127.0.0.1:8545';
export const EXPLORER_URL: string | undefined = known?.explorer;
export const IS_LOCAL = CHAIN_ID === 31337;

export const chain: Chain = defineChain({
  id: CHAIN_ID,
  name: known?.name ?? `Chain ${CHAIN_ID}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  ...(EXPLORER_URL ? { blockExplorers: { default: { name: 'Fluentscan', url: EXPLORER_URL } } } : {}),
});

const d = deployments[String(CHAIN_ID)] as Deployment | undefined;
export const deployment: Deployment | undefined = d;

export function requireDeployment(): Deployment {
  if (!d) throw new Error(`No contract addresses for chainId ${CHAIN_ID} (deployments/${CHAIN_ID}.json)`);
  return d;
}
