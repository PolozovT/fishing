# Ончейн Рыбалка — веб-клиент

Браузерный фронтенд для контрактов из `../contracts` (FishingGame, FishNFT, RodNFT, PearlToken, Marketplace).
Стек: Vite + TypeScript + viem, без UI-фреймворка (чистый DOM + canvas).

## Быстрый старт (локально, anvil)

1. Запустите anvil с блоками раз в секунду и задеплойте контракты:

   ```sh
   anvil --block-time 1
   cd ../contracts
   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <ключ-anvil>
   ```

   Скрипт деплоя пишет адреса в `../deployments/31337.json`.

2. Установите зависимости и запустите фронтенд:

   ```sh
   cd web
   pnpm install
   pnpm dev          # http://localhost:5173 (перед стартом выполняет pnpm sync)
   ```

3. Откройте http://localhost:5173 и нажмите **«Локальный burner (anvil)»**.

## Кошельки

- **Браузерный кошелёк** (`window.ethereum`, например MetaMask) — кнопка «Подключить кошелёк». Клиент попросит
  переключиться на нужную сеть (или добавить её).
- **Локальный burner** — только для chainId 31337 (anvil). Случайный приватный ключ создаётся и хранится в
  `localStorage` этого браузера, на баланс зачисляется 10 ETH через `anvil_setBalance`. **Не используйте этот режим
  с реальными средствами.** Чтобы начать заново с новым адресом, удалите ключ `onchain-fishing:burner-key` из localStorage.

## Скрипты

| Команда          | Что делает                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `pnpm sync`      | Копирует ABI из `../contracts/out/<Name>.sol/<Name>.json` и адреса из `../deployments/*.json` в `src/generated/` |
| `pnpm dev`       | `sync` + dev-сервер Vite на порту 5173                                                        |
| `pnpm build`     | `sync` + проверка типов (`tsc`) + production-сборка в `dist/`                                 |
| `pnpm typecheck` | только проверка типов                                                                         |

После изменения контрактов: `forge build` (и передеплой при необходимости), затем `pnpm sync`.
Если `contracts/out` отсутствует, `sync` оставит уже сгенерированные файлы.

## Настройки (переменные окружения Vite)

- `VITE_RPC_URL` — RPC узла (по умолчанию `http://127.0.0.1:8545`).
- `VITE_CHAIN_ID` — chainId (по умолчанию `31337`); адреса берутся из `deployments/<chainId>.json`.

## Что есть в интерфейсе

- **Шапка**: адрес, ETH, PEARL, энергия с таймером восстановления, опыт, число уловов.
- **Водоём** (canvas): заброс, поплавок покачивается, пока ждём блоки (`блок N/M`), поклёвка, авто-подсечка
  (переключатель) или кнопка «Подсечь!», всплеск и карточка улова с SVG рыбы из `tokenURI`, «Сорвалась!» при промахе.
- **Выбор места** (закрытые места серые, с требуемым уровнем удочки), **удочки** (уровень/прочность), **наживки** (остатки).
- **Садок**: рыбы с картинками, весом и ценой продажи (`quoteSell`), мультивыбор и продажа (`sellFish`).
- **Магазин**: наживка, восстановление энергии (`refillPrice`), новая удочка, улучшение/ремонт выбранной удочки
  (`upgradeCost` / `repairCost`, ремонт недоступен ниже `minRepairLevel`). Все цены читаются из контракта.
- **Рынок**: выставить рыбу/удочку (с `setApprovalForAll`), снять свой лот, купить чужой (с `approve` PEARL).
  Индекс лотов строится по событиям `Listed`/`Cancelled`/`Sold` начиная с `startBlock` и сверяется с `listings()`.
- **Рекорды**: рекорд недели (`weeklyBest(currentWeek())`) и топ-10 самых тяжёлых рыб по событиям `Caught`.
- Ошибки контрактов (custom errors) декодируются по ABI всех контрактов и показываются по-русски.

## Структура

```
scripts/sync-abi.mjs   генерация src/generated/* из ../contracts/out и ../deployments
src/generated/         ABI (as const) и адреса — генерируются, руками не править
src/abi/index.ts       реэкспорт ABI
src/config.ts          сеть, RPC, адреса
src/clients.ts         publicClient, burner и injected кошельки
src/store.ts           состояние и загрузка данных из сети (логи, view-функции)
src/actions.ts         транзакции игры и рынка
src/tx.ts              simulate → send → receipt, тосты
src/errors.ts          декодирование custom errors
src/i18n.ts            русские названия рыб/мест/наживок и тексты ошибок
src/scene.ts           анимация водоёма на canvas
src/ui/*.ts            панели интерфейса
```
