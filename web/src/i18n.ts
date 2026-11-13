// UI labels and messages. Species, spot and bait names come straight from the contracts (already English).

export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];
export const RARITY_CLASS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];

export const ERRORS: Record<string, string> = {
  // FishingGame
  UnknownRod: 'Unknown rod',
  UnknownLure: 'Unknown lure',
  UnknownLocation: 'Unknown location',
  UnknownSpecial: 'Unknown special fish',
  UnknownAchievement: 'Unknown achievement',
  AlreadyOwned: 'You already own this rod',
  NotOwned: 'You do not own this',
  RodBroken: 'Rod is worn out: repair it or switch rods',
  NothingToRepair: 'Rod is already in full condition',
  LocationInactive: 'This location is closed right now',
  LocationLocked: 'This location is locked',
  NotEnoughEnergy: 'Not enough energy',
  EnergyFull: 'Energy is already full',
  CastInProgress: 'The line is already in the water',
  NoActiveCast: 'No active cast',
  TooEarly: 'Too early: waiting for the target block',
  NotFishOwner: 'One of these fish is not yours any more',
  SpecialNotHeld: 'You need to hold this fish to use its bonus',
  NotCompleted: 'Not completed yet',
  AlreadyClaimed: 'Already claimed',
  BadConfig: 'Invalid game configuration',
  // NFTs / token
  NotGame: 'Only the game contract can do this',
  BadSpecies: 'Invalid fish species',
  NotMinter: 'Not allowed to mint PEARL',
  ERC20InsufficientAllowance: 'Insufficient PEARL allowance (approve)',
  ERC20InvalidReceiver: 'Invalid recipient',
  ERC721NonexistentToken: 'Token does not exist (already sold or burned)',
  ERC721InsufficientApproval: 'Not approved to transfer this NFT (approve)',
  ERC721IncorrectOwner: 'You do not own this NFT',
  ERC721InvalidReceiver: 'Invalid NFT recipient',
  // PearlExchange
  Paused: 'Buying PEARL is paused right now',
  ZeroAmount: 'Enter an amount',
  ERC20InsufficientBalance: 'Not enough PEARL or BLEND for this',
  // Marketplace
  CollectionNotAllowed: 'This collection cannot be sold on the market',
  NotListed: 'Listing not found or already sold',
  NotSeller: 'You are not the seller of this listing',
  ZeroPrice: 'Price must be greater than zero',
  FeeTooHigh: 'Fee is too high',
  ReentrancyGuardReentrantCall: 'Reentrant call rejected',
  OwnableUnauthorizedAccount: 'Owner permission required',
};
