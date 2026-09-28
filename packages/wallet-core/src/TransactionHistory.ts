/**
 * TransactionHistory v0.4.2
 * Combines public on-chain activity with private record history.
 *
 * Public txs:  fetched from explorer API (visible to everyone)
 * Private txs: scanned from blockchain using view key (only visible to owner)
 */

import { scanPrivateBalance } from './RecordScanner.js';


const DEFAULT_EXPLORER_API = 'https://api.testnet.riczscan.com';

export type TxRole = 'sender' | 'recipient' | 'self';
export type TxType = 'public' | 'private' | 'public_to_private' | 'private_to_public' | 'split' | 'join' | 'unknown';

export interface HistoryEntry {
  txId: string;
  blockHeight: number;
  timestamp: number | null;
  type: TxType;
  role: TxRole;
  amountMicrocredits: bigint;
  amountRicz: number;
  function: string;
  isPrivate: boolean;
  explorerUrl: string;
}

export interface TransactionHistory {
  address: string;
  entries: HistoryEntry[];
  totalPublicMicrocredits: bigint;
  totalPrivateMicrocredits: bigint;
  scannedAt: number;
}

function mapFunction(fn: string): TxType {
  switch (fn) {
    case 'transfer_public': return 'public';
    case 'transfer_public_to_private': return 'public_to_private';
    case 'transfer_private_to_public': return 'private_to_public';
    case 'transfer_private': return 'private';
    case 'split': return 'split';
    case 'join': return 'join';
    default: return 'unknown';
  }
}

/**
 * Get combined transaction history for a wallet.
 * Includes both public on-chain activity and private record history.
 *
 * @param address       - ricz1... address (for public history)
 * @param privateKeyStr - RPrivateKey1... (for private history)
 * @param fromBlock     - Start block for private scan (default: last 1000 blocks)
 * @param explorerApi   - Explorer API URL (default: api.testnet.riczscan.com)
 */
export async function getTransactionHistory(
  address: string,
  privateKeyStr?: string,
  fromBlock?: number,
  explorerApi = DEFAULT_EXPLORER_API
): Promise<TransactionHistory> {

  const entries: HistoryEntry[] = [];

  // ── 1. Fetch public transaction history from explorer API ──────────────────
  try {
    const res = await fetch(`${explorerApi}/api/address/${address}`);
    if (res.ok) {
      const data = await res.json() as any;
      const activity = data.recent_activity ?? [];

      for (const tx of activity) {
        entries.push({
          txId: tx.transaction_id,
          blockHeight: tx.block_height,
          timestamp: tx.timestamp ?? null,
          type: mapFunction(tx.function),
          role: tx.role as TxRole,
          amountMicrocredits: BigInt(Math.floor(Number(tx.amount ?? 0))),
          amountRicz: Number(tx.amount ?? 0) / 1_000_000,
          function: tx.function,
          isPrivate: false,
          explorerUrl: `https://explorer.testnet.riczscan.com/transactions/${tx.transaction_id}`,
        });
      }
    }
  } catch (_) {
    // Explorer unavailable — continue with private only
  }

  // ── 2. Scan private record history ─────────────────────────────────────────
  let totalPrivateMicrocredits = 0n;

  if (privateKeyStr?.startsWith('RPrivateKey1')) {
    try {
      // Default: scan last 1000 blocks
      const scanFrom = fromBlock ?? 0;
      // Always scan exactly 5000 blocks from fromBlock
      const scanTo = scanFrom + 5000;

      const scan = await scanPrivateBalance(privateKeyStr, scanFrom, scanTo);
      totalPrivateMicrocredits = scan.totalMicrocredits;

      for (const record of scan.records) {
        // Check if this txId is already in public history
        const alreadyAdded = entries.some(e => e.txId === record.txId);
        if (alreadyAdded) continue;

        entries.push({
          txId: record.txId,
          blockHeight: record.blockHeight,
          timestamp: null, // private txs don't expose timestamp
          type: 'private',
          role: 'recipient',
          amountMicrocredits: record.microcredits,
          amountRicz: Number(record.microcredits) / 1_000_000,
          function: 'private_record',
          isPrivate: true,
          explorerUrl: `https://explorer.testnet.riczscan.com/transactions/${record.txId}`,
        });
      }
    } catch (_) {
      // Scan failed — continue with public only
    }
  }

  // ── 3. Sort by block height descending (newest first) ─────────────────────
  entries.sort((a, b) => b.blockHeight - a.blockHeight);

  // ── 4. Calculate public balance total ─────────────────────────────────────
  const totalPublicMicrocredits = entries
    .filter(e => !e.isPrivate && e.role === 'recipient')
    .reduce((sum, e) => sum + e.amountMicrocredits, 0n);

  return {
    address,
    entries,
    totalPublicMicrocredits,
    totalPrivateMicrocredits,
    scannedAt: Date.now(),
  };
}

async function getLatestHeight(explorerApi: string): Promise<number> {
  try {
    const res = await fetch(`${explorerApi}/api/stats`);
    const data = await res.json() as any;
    return data.latest_block_height ?? 0;
  } catch {
    return 0;
  }
}
