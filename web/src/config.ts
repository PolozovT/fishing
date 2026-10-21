import { defineChain, type Chain } from 'viem';
import { deployments, type Deployment } from './generated/deployments';

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);
export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8545';
export const IS_LOCAL = CHAIN_ID === 31337;

export const chain: Chain = defineChain({
  id: CHAIN_ID,
  name: IS_LOCAL ? 'Anvil (локально)' : `Chain ${CHAIN_ID}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const d = deployments[String(CHAIN_ID)] as Deployment | undefined;
export const deployment: Deployment | undefined = d;

export function requireDeployment(): Deployment {
  if (!d) throw new Error(`Нет адресов контрактов для chainId ${CHAIN_ID} (deployments/${CHAIN_ID}.json)`);
  return d;
}
