// Russian names for the onchain catalog (contracts store English names).

export const SPECIES_RU: Record<string, string> = {
  Roach: 'Плотва',
  'Crucian Carp': 'Карась',
  Perch: 'Окунь',
  Tench: 'Линь',
  'Golden Carp': 'Золотой карп',
  Pike: 'Щука',
  Trout: 'Форель',
  Zander: 'Судак',
  Grayling: 'Хариус',
  Taimen: 'Таймень',
  Bream: 'Лещ',
  Burbot: 'Налим',
  Whitefish: 'Сиг',
  'Wels Catfish': 'Сом',
  'Lake Spirit': 'Дух озера',
  Herring: 'Сельдь',
  Cod: 'Треска',
  'Atlantic Salmon': 'Сёмга',
  Halibut: 'Палтус',
  'Bluefin Tuna': 'Синий тунец',
};

export const SPOTS_RU: Record<string, string> = {
  'Village Pond': 'Деревенский пруд',
  'Forest River': 'Лесная река',
  'Deep Lake': 'Глубокое озеро',
  'Northern Sea': 'Северное море',
  'Taimen Rapids': 'Таёжные пороги',
};

export const BAITS_RU: Record<string, string> = {
  None: 'Без наживки',
  Worm: 'Червь',
  'Shiny Lure': 'Блесна',
  'Golden Fly': 'Золотая мушка',
};

export const RARITY_RU = ['Обычная', 'Необычная', 'Редкая', 'Эпическая', 'Легендарная'];
export const RARITY_CLASS = ['r0', 'r1', 'r2', 'r3', 'r4'];

export const ru = (map: Record<string, string>, name: string): string => map[name] ?? name;

export const ERRORS_RU: Record<string, string> = {
  // FishingGame
  NotRodOwner: 'Это не ваша удочка',
  RodLevelTooLow: 'Уровень удочки слишком низкий для этого места',
  RodBroken: 'Удочка сломана — почините её в магазине',
  SpotInactive: 'Это место сейчас закрыто',
  UnknownSpot: 'Неизвестное место',
  UnknownBait: 'Неизвестная наживка',
  NotEnoughEnergy: 'Нет энергии',
  NotEnoughBait: 'Закончилась наживка',
  CastInProgress: 'Заброс ещё в процессе — дождитесь поклёвки',
  NoActiveCast: 'Нет активного заброса',
  TooEarly: 'Слишком рано — ждём нужный блок',
  StarterAlreadyClaimed: 'Стартовая удочка уже получена',
  MaxLevel: 'Удочка уже максимального уровня',
  NothingToRepair: 'Удочка и так целая',
  NotFishOwner: 'Это не ваша рыба',
  BadConfig: 'Неверная конфигурация игры',
  RodInUse: 'Удочка сейчас в воде',
  WrongFee: 'Неверная плата за удочку',
  RepairNotAllowed: 'Эту удочку нельзя починить — улучшите её',
  // NFTs / token
  NotGame: 'Только игровой контракт может это делать',
  BadSpecies: 'Неверный вид рыбы',
  RodLocked: 'Удочка заблокирована — она в воде',
  NotMinter: 'Нет прав на выпуск PEARL',
  ERC20InsufficientBalance: 'Недостаточно PEARL',
  ERC20InsufficientAllowance: 'Недостаточно разрешения на списание PEARL (approve)',
  ERC20InvalidReceiver: 'Неверный получатель',
  ERC721NonexistentToken: 'Такого токена нет (уже продан или сожжён)',
  ERC721InsufficientApproval: 'Нет разрешения на перевод NFT (approve)',
  ERC721IncorrectOwner: 'Вы не владелец этого NFT',
  ERC721InvalidReceiver: 'Неверный получатель NFT',
  // Marketplace
  CollectionNotAllowed: 'Эту коллекцию нельзя продавать на рынке',
  NotListed: 'Лот не найден или уже продан',
  NotSeller: 'Вы не продавец этого лота',
  ZeroPrice: 'Цена должна быть больше нуля',
  FeeTooHigh: 'Слишком высокая комиссия',
  ReentrancyGuardReentrantCall: 'Повторный вход запрещён',
  OwnableUnauthorizedAccount: 'Нет прав владельца',
};
