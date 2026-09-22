/**
 * HD (Hierarchical Deterministic) account derivation.
 *
 * We use HMAC-SHA512 with a fixed context tag to derive per-account seeds
 * from the master BIP39 seed. This gives us:
 *   - Deterministic: same mnemonic + index always → same key
 *   - Isolated: leaking account N's private key does NOT expose account M
 *   - Simple: no elliptic curve arithmetic (which Aleo's curve doesn't play
 *     nicely with BIP32/secp256k1 anyway)
 *
 * The derivation path we conceptually follow is:
 *   m / 44' / 2597' / accountIndex' / 0 / 0
 *
 * (2597 = Aleo's SLIP-44 coin type. Ricchezza reuses it for interop.)
 *
 * Concrete algorithm:
 *   seedForAccount(N) = HMAC-SHA512(
 *     key = "Ricchezza-HD-v1",
 *     data = masterSeed || uint32BE(N)
 *   ).slice(0, 32)
 *
 * The first 32 bytes are passed to PrivateKey.from_seed_unchecked().
 */

import * as bip39 from 'bip39';
import { PrivateKey } from '@ricchezza/sdk';
import { createHmac } from 'node:crypto';

export const COIN_TYPE = 2597; // Aleo SLIP-44
const HMAC_CONTEXT = 'Ricchezza-HD-v1';

/** Derive the private key for a given account index from a mnemonic. */
export function deriveAccountPrivateKey(mnemonic: string, accountIndex: number): PrivateKey {
  if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 2 ** 31 - 1) {
    throw new Error(`Invalid account index: ${accountIndex} (must be 0..2^31-1)`);
  }
  if (!bip39.validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic');
  }

  const masterSeed = bip39.mnemonicToSeedSync(mnemonic); // 64 bytes

  // uint32 big-endian
  const indexBytes = Buffer.alloc(4);
  indexBytes.writeUInt32BE(accountIndex, 0);

  const material = Buffer.concat([masterSeed, indexBytes]);

  // HMAC-SHA512 → 64 bytes; we use first 32 as the private-key seed
  const hmac = createHmac('sha512', HMAC_CONTEXT).update(material).digest();
  const seedForAccount = hmac.subarray(0, 32);

  return PrivateKey.from_seed_unchecked(seedForAccount);
}

/** Derive just the address for a given account (cheaper — no key exposed). */
export function deriveAccountAddress(mnemonic: string, accountIndex: number): string {
  return deriveAccountPrivateKey(mnemonic, accountIndex).to_address().to_string();
}
