/**
 * KeyManager — generate, import, encrypt, and decrypt Ricchezza wallets.
 * 
 * Security design:
 * - Password → PBKDF2 (SHA-256, 210,000 iterations, per-keystore salt)
 * - Encryption → AES-256-GCM (per-keystore IV)
 * - Private keys never leave this module unencrypted except during unlockKeystore()
 * - Works in browsers, Chrome extensions (MV3), and Node.js 20+
 */

import { PrivateKey } from '@ricchezza/sdk';
import * as bip39 from 'bip39';

// ─── Types (public) ────────────────────────────────────────────

/** Shape of an encrypted keystore. Store as JSON in browser storage. */
export interface EncryptedKeystore {
  version: 1;
  ciphertext: string;   // base64
  salt: string;         // base64
  iv: string;           // base64
  iterations: number;
  algorithm: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
}

/** Returned by generateWallet(). Includes mnemonic so user can back up. */
export interface GeneratedWallet {
  address: string;                 // "ricz1..."
  mnemonic: string;                // 12 words (SHOW ONCE, then discard from memory)
  encryptedKeystore: EncryptedKeystore;
}

/** Returned by importFromMnemonic() / importFromPrivateKey(). */
export interface ImportedWallet {
  address: string;
  encryptedKeystore: EncryptedKeystore;
}

/** Returned by unlockKeystore(). Contains sensitive keys — clear after use. */
export interface UnlockedWallet {
  address: string;
  privateKey: string;              // "RPrivateKey1..."
  viewKey: string;                 // "RViewKey1..."
}

// ─── Constants ─────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;

// ─── Encoding helpers ──────────────────────────────────────────

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

// ─── Password → AES key derivation ─────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordBytes = new TextEncoder().encode(password);
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    passwordBytes as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── Encrypt / decrypt payloads ────────────────────────────────

async function encryptPayload(plaintext: string, password: string): Promise<EncryptedKeystore> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource
  );
  return {
    version: 1,
    ciphertext: toBase64(new Uint8Array(ciphertextBuf)),
    salt: toBase64(salt),
    iv: toBase64(iv),
    iterations: PBKDF2_ITERATIONS,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
  };
}

async function decryptPayload(keystore: EncryptedKeystore, password: string): Promise<string> {
  if (keystore.version !== 1) {
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
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    throw new Error('Incorrect password or corrupted keystore');
  }
}

// ─── Mnemonic ↔ PrivateKey conversion ──────────────────────────

/**
 * Derives a Ricchezza private key from a BIP39 mnemonic.
 * We take the seed's first 32 bytes and hand them to PrivateKey.from_seed_unchecked().
 */
function mnemonicToPrivateKey(mnemonic: string): PrivateKey {
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic (must be a valid BIP39 12/24-word phrase)');
  }
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const seedFirst32 = seed.subarray(0, 32);
  // Use the SDK's seed-based constructor
  return PrivateKey.from_seed_unchecked(seedFirst32);
}

// ─── PUBLIC API ─────────────────────────────────────────────────

/**
 * Generate a brand new wallet.
 * Frontend responsibilities:
 * 1. Show the mnemonic to the user for backup (require them to confirm)
 * 2. Save encryptedKeystore to storage (chrome.storage.local for extensions)
 * 3. Display the address as the wallet's public identity
 */
export async function generateWallet(password: string): Promise<GeneratedWallet> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words
  const privateKey = mnemonicToPrivateKey(mnemonic);
  const address = privateKey.to_address().to_string();
  const privateKeyStr = privateKey.to_string();

  // Encrypt both the mnemonic and the private key inside the keystore
  const payload = JSON.stringify({ mnemonic, privateKey: privateKeyStr });
  const encryptedKeystore = await encryptPayload(payload, password);

  return { address, mnemonic, encryptedKeystore };
}

/**
 * Import a wallet from a BIP39 mnemonic (12 or 24 words).
 * Same encryption as generateWallet — the mnemonic is stored (encrypted)
 * inside the keystore so the user can re-view it later if needed.
 */
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

  const privateKey = mnemonicToPrivateKey(trimmed);
  const address = privateKey.to_address().to_string();
  const privateKeyStr = privateKey.to_string();

  const payload = JSON.stringify({ mnemonic: trimmed, privateKey: privateKeyStr });
  const encryptedKeystore = await encryptPayload(payload, password);

  return { address, encryptedKeystore };
}

/**
 * Import a wallet from a raw private key (RPrivateKey1...).
 * No mnemonic will be stored — user has direct-key access only.
 */
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
  } catch (e) {
    throw new Error('Invalid private key format');
  }

  const address = privateKey.to_address().to_string();

  // No mnemonic available for this path
  const payload = JSON.stringify({ mnemonic: null, privateKey: trimmed });
  const encryptedKeystore = await encryptPayload(payload, password);

  return { address, encryptedKeystore };
}

/**
 * Unlock an encrypted keystore.
 * Returns the sensitive keys IN MEMORY. Clear them after use.
 * Throws on wrong password.
 */
export async function unlockKeystore(
  keystore: EncryptedKeystore,
  password: string
): Promise<UnlockedWallet> {
  const decrypted = await decryptPayload(keystore, password);
  const { privateKey: privateKeyStr } = JSON.parse(decrypted) as {
    mnemonic: string | null;
    privateKey: string;
  };
  const privateKey = PrivateKey.from_string(privateKeyStr);
  return {
    address: privateKey.to_address().to_string(),
    privateKey: privateKeyStr,
    viewKey: privateKey.to_view_key().to_string(),
  };
}

/**
 * Retrieve the mnemonic from an encrypted keystore.
 * For "Show recovery phrase" feature. Returns null if imported via private key.
 */
export async function getMnemonic(
  keystore: EncryptedKeystore,
  password: string
): Promise<string | null> {
  const decrypted = await decryptPayload(keystore, password);
  const parsed = JSON.parse(decrypted) as { mnemonic: string | null };
  return parsed.mnemonic;
}

/**
 * Change the password on an existing keystore.
 * Requires the current password to unlock, then re-encrypts with the new one.
 */
export async function changePassword(
  keystore: EncryptedKeystore,
  currentPassword: string,
  newPassword: string
): Promise<EncryptedKeystore> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters');
  }
  const decrypted = await decryptPayload(keystore, currentPassword);
  return encryptPayload(decrypted, newPassword);
}

// ─── Validation helpers (safe to call from UI) ─────────────────

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
