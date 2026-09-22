/**
 * KeyManager — HD wallet key management for Ricchezza.
 *
 * Storage model (encrypted inside keystore):
 * {
 *   mnemonic: string | null,   // null if imported via private key
 *   privateKey: string | null, // set for PK-imported wallets only
 *   accountCount: number,      // how many accounts have been added (min 1)
 * }
 *
 * The addresses list is stored separately in the keystore (unencrypted)
 * so listAccounts() can work without decrypting.
 */

import { PrivateKey } from '@ricchezza/sdk';
import * as bip39 from 'bip39';
import { deriveAccountPrivateKey, deriveAccountAddress } from './derivation.js';

// ─── Types ──────────────────────────────────────────────────────

export interface AccountEntry {
  index: number;    // 0, 1, 2, ...
  address: string;  // "ricz1..."
}

export interface EncryptedKeystore {
  version: 2;
  ciphertext: string;   // base64 (encrypted secrets)
  salt: string;         // base64
  iv: string;           // base64
  iterations: number;
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  accounts: AccountEntry[];  // unencrypted — just addresses
  hdCapable: boolean;        // true if wallet was created from mnemonic
}

export interface GeneratedWallet {
  address: string;                 // account 0's address
  addresses: string[];             // for HD, just [address] initially
  mnemonic: string;
  encryptedKeystore: EncryptedKeystore;
}

export interface ImportedWallet {
  address: string;
  addresses: string[];
  encryptedKeystore: EncryptedKeystore;
}

export interface UnlockedWallet {
  index: number;
  address: string;
  privateKey: string;
  viewKey: string;
}

// Internal shape of encrypted payload
interface KeystorePayload {
  mnemonic: string | null;
  privateKey: string | null;
  accountCount: number;
}

// ─── Constants ──────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;

// ─── Encoding helpers ───────────────────────────────────────────

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof btoa === 'function') {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString('base64');
};

const fromBase64 = (s: string): Uint8Array => {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
};

// ─── Password → AES key derivation ──────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  const passwordKey = await crypto.subtle.importKey(
    'raw', passwordBytes as BufferSource, 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── Encrypt / decrypt helpers ──────────────────────────────────

async function encryptPayload(
  payload: KeystorePayload,
  password: string,
  accounts: AccountEntry[],
  hdCapable: boolean
): Promise<EncryptedKeystore> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const plaintext = JSON.stringify(payload);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource
  );
  return {
    version: 2,
    ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
    salt: toBase64(salt),
    iv: toBase64(iv),
    iterations: PBKDF2_ITERATIONS,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    accounts,
    hdCapable,
  };
}

async function decryptPayload(
  keystore: EncryptedKeystore,
  password: string
): Promise<KeystorePayload> {
  if (keystore.version !== 2) {
    throw new Error(`Unsupported keystore version: ${keystore.version}`);
  }
  const salt = fromBase64(keystore.salt);
  const iv = fromBase64(keystore.iv);
  const ciphertext = fromBase64(keystore.ciphertext);
  const key = await deriveKey(password, salt);
  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource
    );
    return JSON.parse(new TextDecoder().decode(plainBuf)) as KeystorePayload;
  } catch (e) {
    throw new Error('Incorrect password or corrupted keystore');
  }
}

// ─── PUBLIC API — Wallet creation ───────────────────────────────

export async function generateWallet(password: string): Promise<GeneratedWallet> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const mnemonic = bip39.generateMnemonic(128); // 12 words
  const address = deriveAccountAddress(mnemonic, 0);

  const payload: KeystorePayload = {
    mnemonic,
    privateKey: null,
    accountCount: 1,
  };
  const accounts: AccountEntry[] = [{ index: 0, address }];
  const encryptedKeystore = await encryptPayload(payload, password, accounts, true);

  return { address, addresses: [address], mnemonic, encryptedKeystore };
}

export async function importFromMnemonic(
  mnemonic: string,
  password: string
): Promise<ImportedWallet> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const trimmed = mnemonic.trim().replace(/\s+/g, ' ');
  if (!bip39.validateMnemonic(trimmed)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const address = deriveAccountAddress(trimmed, 0);
  const payload: KeystorePayload = {
    mnemonic: trimmed,
    privateKey: null,
    accountCount: 1,
  };
  const accounts: AccountEntry[] = [{ index: 0, address }];
  const encryptedKeystore = await encryptPayload(payload, password, accounts, true);

  return { address, addresses: [address], encryptedKeystore };
}

export async function importFromPrivateKey(
  privateKeyStr: string,
  password: string
): Promise<ImportedWallet> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const trimmed = privateKeyStr.trim();
  if (!trimmed.startsWith('RPrivateKey1')) {
    throw new Error('Invalid private key (must start with RPrivateKey1)');
  }

  let privateKey: PrivateKey;
  try {
    privateKey = PrivateKey.from_string(trimmed);
  } catch {
    throw new Error('Invalid private key format');
  }
  const address = privateKey.to_address().to_string();

  const payload: KeystorePayload = {
    mnemonic: null,
    privateKey: trimmed,
    accountCount: 1,
  };
  const accounts: AccountEntry[] = [{ index: 0, address }];
  // hdCapable = false — PK-imported wallets cannot add accounts
  const encryptedKeystore = await encryptPayload(payload, password, accounts, false);

  return { address, addresses: [address], encryptedKeystore };
}

// ─── PUBLIC API — Multi-account management ──────────────────────

/**
 * List all accounts currently in this keystore. Does not require password
 * (uses the unencrypted addresses field of the keystore).
 */
export function listAccounts(keystore: EncryptedKeystore): AccountEntry[] {
  return [...keystore.accounts];
}

/**
 * Add a new account to the keystore. Only works for HD wallets (those
 * created from a mnemonic). Throws for PK-imported wallets.
 *
 * Returns the new keystore (with one more account) and the new account entry.
 */
export async function addAccount(
  keystore: EncryptedKeystore,
  password: string
): Promise<{ newAccount: AccountEntry; encryptedKeystore: EncryptedKeystore }> {
  if (!keystore.hdCapable) {
    throw new Error('This wallet cannot add accounts (imported via private key, no mnemonic available)');
  }

  const payload = await decryptPayload(keystore, password);
  if (!payload.mnemonic) {
    throw new Error('Keystore is missing its mnemonic (should not happen for HD wallets)');
  }

  const newIndex = payload.accountCount;
  const newAddress = deriveAccountAddress(payload.mnemonic, newIndex);
  const newAccount: AccountEntry = { index: newIndex, address: newAddress };

  const newPayload: KeystorePayload = {
    ...payload,
    accountCount: payload.accountCount + 1,
  };
  const newAccounts = [...keystore.accounts, newAccount];
  const encryptedKeystore = await encryptPayload(newPayload, password, newAccounts, true);

  return { newAccount, encryptedKeystore };
}

/**
 * Unlock a specific account by index. Default is 0 (backward-compatible
 * with v0.1.0's unlockKeystore).
 */
export async function unlockAccount(
  keystore: EncryptedKeystore,
  password: string,
  accountIndex: number = 0
): Promise<UnlockedWallet> {
  const payload = await decryptPayload(keystore, password);

  // Bounds check
  if (accountIndex < 0 || accountIndex >= payload.accountCount) {
    throw new Error(
      `Account index ${accountIndex} out of range (wallet has ${payload.accountCount} account(s))`
    );
  }

  let privateKey: PrivateKey;

  if (payload.privateKey) {
    // PK-imported: only index 0 is valid
    if (accountIndex !== 0) {
      throw new Error('PK-imported wallets only have account 0');
    }
    privateKey = PrivateKey.from_string(payload.privateKey);
  } else if (payload.mnemonic) {
    // HD wallet: derive fresh
    privateKey = deriveAccountPrivateKey(payload.mnemonic, accountIndex);
  } else {
    throw new Error('Keystore has neither mnemonic nor private key');
  }

  return {
    index: accountIndex,
    address: privateKey.to_address().to_string(),
    privateKey: privateKey.to_string(),
    viewKey: privateKey.to_view_key().to_string(),
  };
}

/**
 * Backward-compatibility wrapper for v0.1.0's unlockKeystore(). Always
 * unlocks account 0.
 */
export async function unlockKeystore(
  keystore: EncryptedKeystore,
  password: string
): Promise<Omit<UnlockedWallet, 'index'>> {
  const { address, privateKey, viewKey } = await unlockAccount(keystore, password, 0);
  return { address, privateKey, viewKey };
}

// ─── PUBLIC API — Utility ───────────────────────────────────────

export async function getMnemonic(
  keystore: EncryptedKeystore,
  password: string
): Promise<string | null> {
  const payload = await decryptPayload(keystore, password);
  return payload.mnemonic;
}

export async function changePassword(
  keystore: EncryptedKeystore,
  currentPassword: string,
  newPassword: string
): Promise<EncryptedKeystore> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters');
  }
  const payload = await decryptPayload(keystore, currentPassword);
  return encryptPayload(payload, newPassword, keystore.accounts, keystore.hdCapable);
}

// ─── Validation helpers ─────────────────────────────────────────

export function validateMnemonic(mnemonic: string): boolean {
  const trimmed = (mnemonic ?? '').trim().replace(/\s+/g, ' ');
  return bip39.validateMnemonic(trimmed);
}

export function validatePrivateKey(privateKeyStr: string): boolean {
  const trimmed = (privateKeyStr ?? '').trim();
  if (!trimmed.startsWith('RPrivateKey1')) return false;
  try {
    PrivateKey.from_string(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function validateAddress(address: string): boolean {
  const trimmed = (address ?? '').trim();
  return /^ricz1[a-z0-9]{58,}$/.test(trimmed);
}
