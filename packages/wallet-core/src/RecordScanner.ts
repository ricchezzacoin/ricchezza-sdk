/**
 * RecordScanner v0.3.0
 * Fast record scanning via explorer API ciphertext index.
 * Instead of fetching blocks one by one, fetches pre-indexed ciphertexts
 * and decrypts them locally. Scanning is now seconds instead of minutes.
 */

import { Account } from '@ricchezza/sdk';

const DEFAULT_RPC          = 'https://rpc.testnet.riczscan.com';
const DEFAULT_EXPLORER_API = 'https://api.testnet.riczscan.com';

export interface OwnedRecord {
  plaintext:   string;
  microcredits: bigint;
  txId:        string;
  blockHeight: number;
  spent:       boolean;
  serialNumber?: string;
}

export interface ScanResult {
  totalMicrocredits: bigint;
  records:           OwnedRecord[];
  blocksScanned:     number;
  scannedAt:         number;
}

/**
 * Scan for private records owned by this key.
 * Accepts private key (RPrivateKey1...) or view key (RViewKey1...).
 *
 * Fast path: uses explorer API ciphertext index.
 * Fallback: scans blocks directly via RPC if explorer unavailable.
 */
export async function scanPrivateBalance(
  keyStr:      string,
  fromBlock  = 0,
  toBlock?:    number,
  rpcUrl     = DEFAULT_RPC,
  explorerApi = DEFAULT_EXPLORER_API,
): Promise<ScanResult> {

  // Build account from private key or view key
  if (!keyStr.startsWith('RPrivateKey1') && !keyStr.startsWith('RViewKey1')) {
    throw new Error('Invalid key — must start with RPrivateKey1 or RViewKey1');
  }
  const account = keyStr.startsWith('RPrivateKey1')
    ? new Account({ privateKey: keyStr })
    : new Account({ viewKey: keyStr } as any);

  // Get latest block height if toBlock not specified
  if (toBlock === undefined) {
    const res = await fetch(`${rpcUrl}/testnet/block/height/latest`);
    toBlock = parseInt((await res.text()).replace(/"/g, ''));
  }

  const records: OwnedRecord[] = [];

  // ── Fast path: use explorer ciphertext API ──────────────────────────────
  try {
    const url = `${explorerApi}/api/records/ciphertexts?fromBlock=${fromBlock}&toBlock=${toBlock}&limit=5000`;
    const res = await fetch(url);

    if (res.ok) {
      const data = await res.json() as any;
      const ciphertexts: any[] = data.ciphertexts ?? [];

      console.log(`  Fetched ${ciphertexts.length} ciphertexts from explorer (blocks ${fromBlock}→${toBlock})`);

      for (const item of ciphertexts) {
        try {
          const owns = account.ownsRecordCiphertext(item.ciphertext as any);
          if (!owns) continue;

          const plaintext = account.decryptRecord(item.ciphertext as any);
          const ptStr = plaintext.toString ? plaintext.toString() : String(plaintext);
          const match = ptStr.match(/microcredits:\s*(\d+)u64/);
          const microcredits = match ? BigInt(match[1]) : 0n;

          records.push({
            plaintext:    ptStr,
            microcredits,
            txId:         item.txId,
            blockHeight:  item.blockHeight,
            spent:        false,
          });

          console.log(`  ✓ Found record: ${Number(microcredits) / 1_000_000} RICZ at block ${item.blockHeight}`);
        } catch (_) {}
      }

      const totalMicrocredits = records.reduce((s, r) => s + r.microcredits, 0n);
      console.log(`  Done.`);
      return {
        totalMicrocredits,
        records,
        blocksScanned: toBlock - fromBlock,
        scannedAt:     Date.now(),
      };
    }
  } catch (e: any) {
    console.warn('  Explorer API unavailable, falling back to RPC scan:', e.message);
  }

  // ── Fallback: scan blocks via RPC ───────────────────────────────────────
  console.log(`  Scanning blocks ${fromBlock} → ${toBlock} via RPC (slow fallback)...`);
  const BATCH = 50;

  for (let h = fromBlock; h <= toBlock; h += BATCH) {
    const end = Math.min(h + BATCH - 1, toBlock);
    try {
      const res = await fetch(`${rpcUrl}/testnet/blocks?start=${h}&end=${end}`);
      if (!res.ok) continue;
      const blocks = await res.json();
      if (!Array.isArray(blocks)) continue;

      for (const block of blocks) {
        const txs = block?.transactions ?? [];
        for (const txWrapper of txs) {
          const tx = txWrapper?.transaction ?? txWrapper;
          const txId = tx?.id ?? '';
          const transitions: any[] = [];
          if (tx?.execution?.transitions) transitions.push(...tx.execution.transitions);
          if (tx?.fee?.transition) transitions.push(tx.fee.transition);

          for (const transition of transitions) {
            for (const output of (transition?.outputs ?? [])) {
              if (output?.type !== 'record') continue;
              const ciphertext = output?.value;
              if (!ciphertext || typeof ciphertext !== 'string') continue;

              try {
                const owns = account.ownsRecordCiphertext(ciphertext as any);
                if (!owns) continue;
                const plaintext = account.decryptRecord(ciphertext as any);
                const ptStr = plaintext.toString ? plaintext.toString() : String(plaintext);
                const match = ptStr.match(/microcredits:\s*(\d+)u64/);
                const microcredits = match ? BigInt(match[1]) : 0n;

                records.push({
                  plaintext: ptStr,
                  microcredits,
                  txId,
                  blockHeight: block.header?.metadata?.height ?? h,
                  spent: false,
                });
                console.log(`  ✓ Found record: ${Number(microcredits) / 1_000_000} RICZ`);
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}

    const pct = Math.round(((h - fromBlock) / (toBlock - fromBlock)) * 100);
    if (pct % 20 === 0) process.stdout.write(`  ${pct}% `);
  }

  console.log('\n  Done.');
  const totalMicrocredits = records.reduce((s, r) => s + r.microcredits, 0n);
  return { totalMicrocredits, records, blocksScanned: toBlock - fromBlock, scannedAt: Date.now() };
}

/** Returns total private balance in microcredits. */
export async function getPrivateBalance(
  keyStr:      string,
  fromBlock  = 0,
  toBlock?:    number,
  rpcUrl     = DEFAULT_RPC,
  explorerApi = DEFAULT_EXPLORER_API,
): Promise<bigint> {
  const result = await scanPrivateBalance(keyStr, fromBlock, toBlock, rpcUrl, explorerApi);
  return result.totalMicrocredits;
}
