import type { Abi, ContractFunctionArgs, ContractFunctionName, Address, TransactionReceipt } from 'viem';
import { publicClient, type Wallet } from './clients';
import { IS_FLUENT } from './config';
import { fluentSend } from './fluent';
import { friendlyError } from './errors';
import { toast } from './ui/toast';

type WriteFn<abi extends Abi> = ContractFunctionName<abi, 'nonpayable' | 'payable'>;

export interface WriteParams<abi extends Abi, fn extends WriteFn<abi>> {
  address: Address;
  abi: abi;
  functionName: fn;
  args: ContractFunctionArgs<abi, 'nonpayable' | 'payable', fn>;
  /** Native value (wei) for payable functions. */
  value?: bigint;
}

let busy = 0;
const busyListeners = new Set<(n: number) => void>();
export const onBusy = (f: (n: number) => void): void => void busyListeners.add(f);
const setBusy = (d: number): void => {
  busy += d;
  busyListeners.forEach((f) => f(busy));
};

export class TxError extends Error {
  constructor(
    message: string,
    readonly original: unknown,
  ) {
    super(message);
  }
}

/**
 * Simulate (to get a decoded custom error before the wallet pops up), send, wait for the receipt.
 * Throws TxError with a human-readable message; toasts are shown unless `quiet`.
 */
export async function sendTx<const abi extends Abi, fn extends WriteFn<abi>>(
  wallet: Wallet,
  label: string,
  params: WriteParams<abi, fn>,
  opts: { quiet?: boolean } = {},
): Promise<TransactionReceipt> {
  setBusy(1);
  try {
    // viem's generics don't survive this indirection; the call-site types are checked by WriteParams.
    const sim = await publicClient.simulateContract({
      ...(params as unknown as Parameters<typeof publicClient.simulateContract>[0]),
      account: wallet.account,
    });
    let hash: `0x${string}`;
    if (wallet.mode === 'fluent') {
      if (!IS_FLUENT) throw new Error('Fluent Connect sends on Fluent Testnet, but this build talks to a local chain');
      // One Batch operation per action; the widget shows its Review and may sponsor the gas.
      hash = await fluentSend(
        [{ to: params.address, abi: params.abi, method: params.functionName as string, args: params.args as readonly unknown[], value: params.value }],
        label,
      );
    } else {
      const client = wallet.client;
      if (!client) throw new Error('Wallet cannot sign');
      hash = await client.writeContract({
        ...(sim.request as Parameters<typeof client.writeContract>[0]),
        account: wallet.account,
        chain: client.chain,
      });
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 300 });
    if (receipt.status !== 'success') throw new Error('Transaction reverted');
    if (!opts.quiet) toast(`${label}: done`, 'ok');
    return receipt;
  } catch (e) {
    console.warn(`[tx] ${label} failed`, e);
    const msg = friendlyError(e);
    if (!opts.quiet) toast(`${label}: ${msg}`, 'err');
    throw new TxError(msg, e);
  } finally {
    setBusy(-1);
  }
}
