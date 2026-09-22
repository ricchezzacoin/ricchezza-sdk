/**
 * RecordScanner v0.2.0
 * Scans blocks and decrypts records owned by this view key.
 */

import { Account } from '@ricchezza/sdk';

const DEFAULT_RPC = 'https://rpc.testnet.riczscan.com';

export interface OwnedRecord {
  plaintext: string;
  microcredits: bigint;
  txId: string;
  blockHeight: number;
  spent: boolean;
  serialNumber?: string;
}

export interface ScanResult {
  totalMicrocredits: bigint;
  records: OwnedRecord[];
  blocksScanned: number;
  scannedAt: number;
}

export async function scanPrivateBalance(
  privateKeyStr: string,
  fromBlock = 0,
  toBlock?: number,
  rpcUrl = DEFAULT_RPC
): Promise<ScanResult> {
  if (!privateKeyStr.startsWith('RPrivateKey1')) {
    throw new Error('Invalid private key');
  }

  const account = new Account({ privateKey: privateKeyStr });
  const records: OwnedRecord[] = [];

  // Get latest height if not specified
  if (toBlock === undefined) {
    const res = await fetch(`${rpcUrl}/testnet/block/height/latest`);
    toBlock = parseInt((await res.text()).replace(/"/g, ''));
  }

  console.log(`  Scanning blocks ${fromBlock} → ${toBlock}...`);

  // Scan in batches of 50 blocks
  const BATCH = 50;
  let scanned = 0;

  for (let h = fromBlock; h <= toBlock; h += BATCH) {
    const end = Math.min(h + BATCH - 1, toBlock);

    try {
      // Fetch block range
      const res = await fetch(`${rpcUrl}/testnet/blocks?start=${h}&end=${end}`);
      if (!res.ok) continue;

      const blocks = await res.json();
      if (!Array.isArray(blocks)) continue;

      for (const block of blocks) {
        scanned++;
        const txs = block?.transactions ?? [];

        for (const txWrapper of txs) {
          const tx = txWrapper?.transaction ?? txWrapper;
          const txId = tx?.id ?? '';

          // Get all transitions
          const transitions: any[] = [];
          if (tx?.execution?.transitions) transitions.push(...tx.execution.transitions);
          if (tx?.fee?.transition) transitions.push(tx.fee.transition);

          for (const transition of transitions) {
            const outputs = transition?.outputs ?? [];

            for (const output of outputs) {
              if (output?.type !== 'record') continue;

              const ciphertext = output?.value;
              if (!ciphertext || typeof ciphertext !== 'string') continue;

              try {
                // Check if this record belongs to us
                const owns = account.ownsRecordCiphertext(ciphertext as any);
                if (!owns) continue;

                // Decrypt the record
                const plaintext = account.decryptRecord(ciphertext as any);
                const ptStr = plaintext.toString ? plaintext.toString() : String(plaintext);

                // Extract microcredits
                const match = ptStr.match(/microcredits:\s*(\d+)u64/);
                const microcredits = match ? BigInt(match[1]) : 0n;

                records.push({
                  plaintext: ptStr,
                  microcredits,
                  txId,
                  blockHeight: block.header?.metadata?.height ?? h,
                  spent: false,
                });

                console.log(`  ✓ Found record: ${Number(microcredits) / 1_000_000} RICZ at block ${block.header?.metadata?.height ?? h}`);
              } catch (_) {
                // Decryption failed = not our record
              }
            }
          }
        }
      }
    } catch (e: any) {
      // Skip failed batches
    }

    // Progress
    const pct = Math.round(((h - fromBlock) / (toBlock - fromBlock)) * 100);
    if (pct % 20 === 0) process.stdout.write(`  ${pct}% ` );
  }

  console.log('\n  Done.');

  const totalMicrocredits = records.reduce((s, r) => s + r.microcredits, 0n);

  return {
    totalMicrocredits,
    records,
    blocksScanned: scanned,
    scannedAt: Date.now(),
  };
}

export async function getPrivateBalance(
  privateKeyStr: string,
  fromBlock = 0,
  toBlock?: number,
  rpcUrl = DEFAULT_RPC
): Promise<bigint> {
  const result = await scanPrivateBalance(privateKeyStr, fromBlock, toBlock, rpcUrl);
  return result.totalMicrocredits;
}
