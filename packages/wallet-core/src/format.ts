/**
 * Format helpers for RICZ amounts.
 * 1 RICZ = 1,000,000 microcredits (6 decimal places)
 */

const DECIMALS = 6;
const DIVISOR = 1_000_000n;

/**
 * Convert microcredits (bigint) to a decimal RICZ string.
 * Example: 100_000_000n → "100.000000"
 */
export function microcreditsToRicz(microcredits: bigint): string {
  if (microcredits < 0n) {
    return '-' + microcreditsToRicz(-microcredits);
  }
  const whole = microcredits / DIVISOR;
  const remainder = microcredits % DIVISOR;
  const remainderStr = remainder.toString().padStart(DECIMALS, '0');
  return `${whole}.${remainderStr}`;
}

/**
 * Convert a RICZ decimal string to microcredits (bigint).
 * Example: "100.5" → 100_500_000n
 * Throws on invalid input.
 */
export function riczToMicrocredits(ricz: string): bigint {
  const trimmed = ricz.trim();
  if (!/^-?\d+(\.\d{0,6})?$/.test(trimmed)) {
    throw new Error(`Invalid RICZ amount: ${ricz} (must be a decimal with up to 6 decimal places)`);
  }

  const negative = trimmed.startsWith('-');
  const cleaned = negative ? trimmed.substring(1) : trimmed;

  const [wholePart, fracPart = ''] = cleaned.split('.');
  const fracPadded = (fracPart + '0'.repeat(DECIMALS)).substring(0, DECIMALS);

  const microcredits = BigInt(wholePart) * DIVISOR + BigInt(fracPadded || '0');
  return negative ? -microcredits : microcredits;
}

export interface FormatBalanceOptions {
  /** Include " RICZ" suffix. Defaults to true. */
  symbol?: boolean;
  /** Maximum decimals to show. Trailing zeros stripped. Defaults to 6. */
  maxDecimals?: number;
  /** Minimum decimals to always show. Defaults to 2 for readability. */
  minDecimals?: number;
}

/**
 * Format microcredits as a human-readable balance string.
 * Trailing zeros stripped for cleaner display, but at least minDecimals shown.
 *
 * Examples:
 *   formatBalance(100_000_000n) → "100.00 RICZ"
 *   formatBalance(100_500_000n) → "100.50 RICZ"
 *   formatBalance(100_123_456n) → "100.123456 RICZ"
 *   formatBalance(0n) → "0.00 RICZ"
 *   formatBalance(100_000_000n, { symbol: false }) → "100.00"
 */
export function formatBalance(microcredits: bigint, options: FormatBalanceOptions = {}): string {
  const { symbol = true, maxDecimals = DECIMALS, minDecimals = 2 } = options;

  const full = microcreditsToRicz(microcredits);
  const [whole, frac = ''] = full.split('.');

  // Truncate to maxDecimals
  let truncated = frac.substring(0, Math.min(maxDecimals, DECIMALS));

  // Strip trailing zeros beyond minDecimals
  while (truncated.length > minDecimals && truncated.endsWith('0')) {
    truncated = truncated.substring(0, truncated.length - 1);
  }

  const formatted = truncated ? `${whole}.${truncated}` : whole;
  return symbol ? `${formatted} RICZ` : formatted;
}
