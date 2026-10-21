# Onchain Fishing 🎣

Рыбалка, которая целиком работает в смарт-контрактах: заброс, честный рандом, улов в виде NFT с ончейн-картинкой, валюта PEARL, удочки с уровнями, маркетплейс и недельный рекорд.

Результаты проверки гипотезы — в **[REPORT.md](REPORT.md)**, графики экономики — в [sim/out/report.html](sim/out/report.html).

## Структура

| Папка | Что там |
|---|---|
| `contracts/` | Foundry-проект: `FishingGame`, `FishNFT`, `RodNFT`, `PearlToken`, `Marketplace` + 51 тест |
| `contracts/script/GameSetup.sol` | каталог: виды рыб, места ловли, наживка, цены, конфиг |
| `sim/` | точная модель формул контракта и агентная симуляция экономики (Python, без зависимостей) |
| `web/` | браузерный клиент (Vite + TypeScript + viem), см. [web/README.md](web/README.md) |
| `deployments/` | адреса контрактов по chainId (их пишет деплой-скрипт) |

## Быстрый старт (локально)

Понадобятся [Foundry](https://getfoundry.sh), Node 20+ и pnpm.

1. Локальная сеть с блоком раз в секунду (без этого `reel` будет ждать бесконечно):

```bash
anvil --block-time 1
```

2. Деплой в другом терминале. Ключ `0xf39F…` — публичный тестовый аккаунт anvil:

```bash
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

3. Клиент:

```bash
cd web && pnpm install && pnpm sync && pnpm dev
```

Откройте http://localhost:5173 и выберите режим «локальный кошелёк»: он создаёт одноразовый ключ и сам пополняет его в anvil.

## Тесты и симуляция

```bash
cd contracts && forge test
```

```bash
python3 sim/sim.py && python3 sim/report.py
```

## Деплой в тестнет (например, Base Sepolia)

В эту ночь в тестнет ничего не деплоилось: для этого нужен ваш ключ и тестовый ETH из крана.

1. Получите тестовый ETH на Base Sepolia через любой faucet.
2. Импортируйте ключ в зашифрованное хранилище Foundry (ключ не попадёт в историю шелла):

```bash
cast wallet import fishing-deployer --interactive
```

3. Задеплойте:

```bash
cd contracts && forge script script/Deploy.s.sol --rpc-url https://sepolia.base.org --broadcast --account fishing-deployer
```

4. Адреса запишутся в `deployments/84532.json`. После этого выполните `pnpm sync` в `web/`.

> ⚠️ Рандом основан на `blockhash`. На L2 его контролирует секвенсор, поэтому для чего-то с реальной ценностью замените его на VRF (см. REPORT.md). Код не проходил аудит.

## Как устроен игровой цикл

1. `claimStarterRod()` — бесплатная (или за `starterRodFee` в ETH) удочка 1-го уровня.
2. `cast(rodId, spotId, baitId)` — тратит энергию и наживку, блокирует удочку и фиксирует целевой блок `N+2`.
3. `reel()` — после целевого блока исход считается из его `blockhash`: поймал или сорвалась, какой вид, какой вес. Улов минтится как NFT.
4. `sellFish(ids)` — продать рыбу за PEARL. Также можно оставить её себе или выставить на маркетплейс.
5. PEARL тратится на наживку, восстановление энергии (дорожает ×2 за каждое следующее за день), ремонт, новые удочки и апгрейды. Апгрейд открывает новые места ловли и повышает шанс на редкую рыбу.

Энергия: максимум 20, восстанавливается по 1 каждые 15 минут. Если не вытащить улов в течение 256 блоков, рыба уходит.
