// Key management
export {
  generateWallet,
  importFromMnemonic,
  importFromPrivateKey,
  listAccounts,
  addAccount,
  unlockAccount,
  unlockKeystore,
  getMnemonic,
  changePassword,
  validateMnemonic,
  validatePrivateKey,
  validateAddress,
} from './KeyManager.js';

export type {
  EncryptedKeystore,
  GeneratedWallet,
  ImportedWallet,
  UnlockedWallet,
  AccountEntry,
} from './KeyManager.js';

// Chain client
export { ChainClient } from './ChainClient.js';
export type { ChainClientOptions } from './ChainClient.js';

// Format helpers
export {
  microcreditsToRicz,
  riczToMicrocredits,
  formatBalance,
} from './format.js';
export type { FormatBalanceOptions } from './format.js';

// Transactions (v0.4.0 — all 4 transfer types)
export {
  sendPublic,
  sendPublicToPrivate,
  sendPrivate,
  sendPrivateToPublic,
  estimateFee,
} from './TransactionBuilder.js';
export type {
  TransactionOptions,
  TransactionResult,
} from './TransactionBuilder.js';

// Private balance (v0.4.0)
export {
  scanPrivateBalance,
  getPrivateBalance,
} from './RecordScanner.js';
export type {
  OwnedRecord,
  ScanResult,
} from './RecordScanner.js';

// Constants
export { COIN_TYPE } from './derivation.js';
