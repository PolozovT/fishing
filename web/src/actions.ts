import { parseEther, type TransactionReceipt } from 'viem';
import { fishingGameAbi, fishNftAbi, marketplaceAbi, pearlTokenAbi, rodNftAbi } from './abi';
import { publicClient } from './clients';
import { ADDR, cfgBig, loadPlayer, loadWorld, state, type Listing } from './store';
import { sendTx } from './tx';

const game = { address: ADDR.game, abi: fishingGameAbi } as const;

function wallet() {
  if (!state.wallet) throw new Error('Сначала подключите кошелёк');
  return state.wallet;
}

export async function refreshAll(): Promise<void> {
  await Promise.all([loadPlayer(), loadWorld()]);
}

async function after<T>(p: Promise<T>, world = false): Promise<T> {
  try {
    return await p;
  } finally {
    await (world ? refreshAll() : loadPlayer()).catch((e) => console.warn('refresh failed', e));
  }
}

export const claimStarter = (): Promise<TransactionReceipt> =>
  after(
    sendTx(wallet(), 'Стартовая удочка', {
      ...game,
      functionName: 'claimStarterRod',
      args: [],
      value: cfgBig('starterRodFee'),
    }),
  );

export const castLine = (rodId: bigint, spotId: number, baitId: number): Promise<TransactionReceipt> =>
  sendTx(wallet(), 'Заброс', { ...game, functionName: 'cast', args: [rodId, spotId, baitId] }, { quiet: true });

export const reelIn = (): Promise<TransactionReceipt> =>
  sendTx(wallet(), 'Подсечка', { ...game, functionName: 'reel', args: [] }, { quiet: true });

export const sellFish = (ids: bigint[]): Promise<TransactionReceipt> =>
  after(sendTx(wallet(), `Продажа (${ids.length})`, { ...game, functionName: 'sellFish', args: [ids] }));

export const buyBait = (baitId: number, amount: bigint): Promise<TransactionReceipt> =>
  after(sendTx(wallet(), 'Покупка наживки', { ...game, functionName: 'buyBait', args: [baitId, amount] }));

export const refillEnergy = (): Promise<TransactionReceipt> =>
  after(sendTx(wallet(), 'Восстановление энергии', { ...game, functionName: 'refillEnergy', args: [] }));

export const buyRod = (): Promise<TransactionReceipt> =>
  after(sendTx(wallet(), 'Покупка удочки', { ...game, functionName: 'buyRod', args: [] }));

export const upgradeRod = (rodId: bigint): Promise<TransactionReceipt> =>
  after(sendTx(wallet(), 'Улучшение удочки', { ...game, functionName: 'upgradeRod', args: [rodId] }));

export const repairRod = (rodId: bigint): Promise<TransactionReceipt> =>
  after(sendTx(wallet(), 'Ремонт удочки', { ...game, functionName: 'repairRod', args: [rodId] }));

// ------------------------------------------------------------------ marketplace

export async function listToken(kind: 'fish' | 'rod', tokenId: bigint, priceStr: string): Promise<void> {
  const w = wallet();
  let price: bigint;
  try {
    price = parseEther(priceStr.replace(',', '.').trim());
  } catch {
    throw new Error('Неверная цена');
  }
  if (price <= 0n) throw new Error('Цена должна быть больше нуля');
  if (price >= 2n ** 96n) throw new Error('Слишком большая цена');
  const collection = kind === 'fish' ? ADDR.fish : ADDR.rod;
  await after(
    (async () => {
      if (!state.marketApproved[kind]) {
        // one-time approval for the whole collection
        if (kind === 'fish') {
          await sendTx(w, 'Разрешение рынку (рыба)', {
            address: ADDR.fish,
            abi: fishNftAbi,
            functionName: 'setApprovalForAll',
            args: [ADDR.market, true],
          });
        } else {
          await sendTx(w, 'Разрешение рынку (удочки)', {
            address: ADDR.rod,
            abi: rodNftAbi,
            functionName: 'setApprovalForAll',
            args: [ADDR.market, true],
          });
        }
      }
      await sendTx(w, 'Выставлено на рынок', {
        address: ADDR.market,
        abi: marketplaceAbi,
        functionName: 'list',
        args: [collection, tokenId, price],
      });
    })(),
    true,
  );
}

export async function buyListing(l: Listing): Promise<void> {
  const w = wallet();
  await after(
    (async () => {
      const allowance = await publicClient.readContract({
        address: ADDR.pearl,
        abi: pearlTokenAbi,
        functionName: 'allowance',
        args: [w.address, ADDR.market],
      });
      if (allowance < l.price) {
        await sendTx(w, 'Разрешение на PEARL', {
          address: ADDR.pearl,
          abi: pearlTokenAbi,
          functionName: 'approve',
          args: [ADDR.market, l.price],
        });
      }
      await sendTx(w, 'Покупка на рынке', {
        address: ADDR.market,
        abi: marketplaceAbi,
        functionName: 'buy',
        args: [l.address, l.tokenId],
      });
    })(),
    true,
  );
}

export const cancelListing = (l: Listing): Promise<TransactionReceipt> =>
  after(
    sendTx(wallet(), 'Лот снят', {
      address: ADDR.market,
      abi: marketplaceAbi,
      functionName: 'cancel',
      args: [l.address, l.tokenId],
    }),
    true,
  );

