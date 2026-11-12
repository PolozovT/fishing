import {
  BaseError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
  decodeErrorResult,
  type Abi,
  type Hex,
} from 'viem';
import { FluentReviewRejectedError } from '@fluent.xyz/connect';
import { fishingGameAbi, fishNftAbi, marketplaceAbi, pearlTokenAbi, rodNftAbi } from './abi';
import { ERRORS } from './i18n';

// Union of every custom error across the game contracts: a revert bubbling up from a nested call
// (e.g. PEARL burn inside FishingGame) is not in the called contract's ABI, so decode against all of them.
const allErrors: Abi = (() => {
  const seen = new Set<string>();
  const out: Abi[number][] = [];
  for (const abi of [fishingGameAbi, fishNftAbi, rodNftAbi, pearlTokenAbi, marketplaceAbi] as readonly Abi[]) {
    for (const item of abi) {
      if (item.type !== 'error' || seen.has(item.name)) continue;
      seen.add(item.name);
      out.push(item);
    }
  }
  return out;
})();

function findRevertData(err: unknown): Hex | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 10 && cur && typeof cur === 'object'; i++) {
    const o = cur as { data?: unknown; raw?: unknown; cause?: unknown };
    if (typeof o.raw === 'string' && o.raw.startsWith('0x') && o.raw.length >= 10) return o.raw as Hex;
    if (typeof o.data === 'string' && o.data.startsWith('0x') && o.data.length >= 10) return o.data as Hex;
    if (o.data && typeof o.data === 'object') {
      const d = (o.data as { data?: unknown }).data;
      if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) return d as Hex;
    }
    cur = o.cause;
  }
  return undefined;
}

/** Returns the custom error name if the failure was a contract revert we can decode. */
export function revertName(err: unknown): string | undefined {
  if (err instanceof BaseError) {
    const rev = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName && rev.data.errorName !== 'Error') {
      return rev.data.errorName;
    }
  }
  const data = findRevertData(err);
  if (data) {
    try {
      return decodeErrorResult({ abi: allErrors, data }).errorName;
    } catch {
      /* not one of ours */
    }
  }
  return undefined;
}

/** Human-readable message for any error thrown by viem / the wallet. */
export function friendlyError(err: unknown): string {
  if (err instanceof FluentReviewRejectedError) return 'Cancelled in the Fluent review';
  const name = revertName(err);
  if (name) return ERRORS[name] ?? `Contract error: ${name}`;
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof UserRejectedRequestError)) return 'Rejected in wallet';
    if (err.walk((e) => e instanceof InsufficientFundsError)) return 'Not enough ETH to pay for gas';
    const rev = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.reason) return `Contract reverted: ${rev.reason}`;
    if (/fetch|network|ECONNREFUSED|Failed to fetch/i.test(err.message)) return 'Cannot reach the network node (RPC)';
    return err.shortMessage || err.message;
  }
  const code = (err as { code?: number } | null)?.code;
  if (code === 4001) return 'Rejected in wallet';
  if (err instanceof Error) return err.message;
  return String(err);
}
