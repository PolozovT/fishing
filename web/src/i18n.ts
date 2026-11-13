// UI labels and messages. Species, spot and bait names come straight from the contracts (already English).

export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
export const RARITY_CLASS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];

export const ERRORS: Record<string, string> = {
  // FishingGame
  NotRodOwner: 'This is not your rod',
  RodLevelTooLow: 'Rod level is too low for this spot',
  RodBroken: 'Rod is broken — repair it in the shop',
  SpotInactive: 'This spot is currently closed',
  UnknownSpot: 'Unknown spot',
  UnknownBait: 'Unknown bait',
  NotEnoughEnergy: 'Not enough energy',
  NotEnoughBait: 'Out of bait',
  CastInProgress: 'Cast still in progress — wait for a bite',
  NoActiveCast: 'No active cast',
  TooEarly: 'Too early — waiting for the target block',
  StarterAlreadyClaimed: 'Starter rod already claimed',
  MaxLevel: 'Rod is already at max level',
  NothingToRepair: 'Rod is already in full condition',
  NotFishOwner: 'This is not your fish',
  BadConfig: 'Invalid game configuration',
  RodInUse: 'Rod is in the water right now',
  WrongFee: 'Wrong rod fee',
  RepairNotAllowed: 'This rod cannot be repaired — upgrade it',
  // NFTs / token
  NotGame: 'Only the game contract can do this',
  BadSpecies: 'Invalid fish species',
  RodLocked: 'Rod is locked — it is in the water',
  NotMinter: 'Not allowed to mint PEARL',
  ERC20InsufficientBalance: 'Not enough PEARL',
  ERC20InsufficientAllowance: 'Insufficient PEARL allowance (approve)',
  ERC20InvalidReceiver: 'Invalid recipient',
  ERC721NonexistentToken: 'Token does not exist (already sold or burned)',
  ERC721InsufficientApproval: 'Not approved to transfer this NFT (approve)',
  ERC721IncorrectOwner: 'You do not own this NFT',
  ERC721InvalidReceiver: 'Invalid NFT recipient',
  // Marketplace
  CollectionNotAllowed: 'This collection cannot be sold on the market',
  NotListed: 'Listing not found or already sold',
  NotSeller: 'You are not the seller of this listing',
  ZeroPrice: 'Price must be greater than zero',
  FeeTooHigh: 'Fee is too high',
  ReentrancyGuardReentrantCall: 'Reentrant call rejected',
  OwnableUnauthorizedAccount: 'Owner permission required',
};
