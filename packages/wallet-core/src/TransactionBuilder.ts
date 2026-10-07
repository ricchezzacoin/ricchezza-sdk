/**
 * TransactionBuilder v0.5.3
 *
 * All four transfer types are signed LOCALLY with the WASM prover:
 *   sendPublic, sendPublicToPrivate, sendPrivate, sendPrivateToPublic
 *   → private key never leaves the device
 *   → ZK proof is generated in-process
 *   → signed transaction is broadcast directly to the RPC node
 *
 * Still via relay (transitional): splitRecord, joinRecords
 *
 * Units: buildTransferTransaction takes the amount in microcredits and the
 * priority fee in RICZ (credits), NOT microcredits.
 */

import {
  ProgramManager,
  AleoKeyProvider,
  AleoNetworkClient,
  Account,
  initThreadPool,
} from '@ricchezza/sdk';

const DEFAULT_RPC     = 'https://rpc.testnet.ricchezzacoin.com';
const DEFAULT_RELAY   = 'https://rpc.testnet.ricchezzacoin.com/relay';
const EXPLORER_BASE   = 'https://explorer.testnet.riczscan.com';
const PRIORITY_FEE    = 0.01; // 0.01 RICZ in credits

export interface TransactionOptions {
  rpcUrl?:   string;
  relayUrl?: string;
}

export interface TransactionResult {
  txId:               string;
  explorerUrl:        string;
  amountMicrocredits: bigint;
  feeMicrocredits:    bigint;
  recipient:          string;
  transferType:       'public' | 'public_to_private' | 'private' | 'private_to_public';
  signedLocally:      boolean; // true = signed on this device, false = relay used
}

// ── Thread pool ─────────────────────────────────────────────────────────────
// Idempotent, and rejects instead of hanging forever if a pool worker never
// starts. A failed init can't be retried inside the same WASM instance, so
// callers (e.g. a Web Worker wrapper) must discard and recreate the worker.
// The error messages start with "Thread pool init" so wrappers can detect them.
let _poolPromise: Promise<void> | null = null;

function ensureThreadPool(timeoutMs = 45_000): Promise<void> {
  if (!_poolPromise) {
    _poolPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Thread pool init timed out — a proving worker failed to start')),
        timeoutMs,
      );
      initThreadPool().then(
        () => { clearTimeout(timer); resolve(); },
        (e: any) => {
          clearTimeout(timer);
          reject(new Error('Thread pool init failed: ' + (e?.message ?? String(e))));
        },
      );
    });
  }
  return _poolPromise;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function validateInputs(pk: string, recipient: string, amount: bigint) {
  if (!pk.startsWith('RPrivateKey1'))
    throw new Error('Invalid private key — must start with RPrivateKey1');
  if (!recipient.startsWith('ricz1'))
    throw new Error('Invalid recipient — must start with ricz1');
  if (amount <= 0n)
    throw new Error('Amount must be greater than 0');
}

function makeResult(
  txId: string,
  amount: bigint,
  recipient: string,
  type: TransactionResult['transferType'],
  signedLocally: boolean,
): TransactionResult {
  return {
    txId,
    explorerUrl:        `${EXPLORER_BASE}/transactions/${txId}`,
    amountMicrocredits: amount,
    feeMicrocredits:    10_000n, // 0.01 RICZ
    recipient,
    transferType:       type,
    signedLocally,
  };
}

// ── Relay (split / join only) ───────────────────────────────────────────────
async function relayPost(
  endpoint: string,
  payload: Record<string, string>,
  relayUrl: string,
): Promise<string> {
  const res = await fetch(`${relayUrl}/${endpoint}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  const data = await res.json() as any;
  if (!res.ok || !data.txId)
    throw new Error(`Transaction failed: ${data.error ?? JSON.stringify(data)}`);
  return data.txId;
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSFERS — signed locally, private key never leaves the device
// ══════════════════════════════════════════════════════════════════════════════

/** transfer_public */
export async function sendPublic(
  privateKeyStr: string,
  recipient:     string,
  amountMicro:   bigint,
  options:       TransactionOptions = {},
): Promise<TransactionResult> {
  validateInputs(privateKeyStr, recipient, amountMicro);

  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;
  await ensureThreadPool();

  const account     = new Account({ privateKey: privateKeyStr });
  const keyProvider = new AleoKeyProvider();
  keyProvider.useCache(true);
  const pm = new ProgramManager(rpcUrl, keyProvider, undefined);
  pm.setAccount(account);

  const tx = await pm.buildTransferTransaction(
    Number(amountMicro),
    recipient,
    'transfer_public',
    PRIORITY_FEE,
    false,
  );

  const txId = tx.id();
  const _nc = new AleoNetworkClient(rpcUrl);
  await _nc.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'public', true);
}

/** transfer_public_to_private */
export async function sendPublicToPrivate(
  privateKeyStr: string,
  recipient:     string,
  amountMicro:   bigint,
  options:       TransactionOptions = {},
): Promise<TransactionResult> {
  validateInputs(privateKeyStr, recipient, amountMicro);

  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;
  await ensureThreadPool();

  const account     = new Account({ privateKey: privateKeyStr });
  const keyProvider = new AleoKeyProvider();
  keyProvider.useCache(true);
  const pm = new ProgramManager(rpcUrl, keyProvider, undefined);
  pm.setAccount(account);

  const tx = await pm.buildTransferTransaction(
    Number(amountMicro),
    recipient,
    'transfer_public_to_private',
    PRIORITY_FEE,
    false,
  );

  const txId = tx.id();
  const _nc = new AleoNetworkClient(rpcUrl);
  await _nc.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'public_to_private', true);
}

/**
 * transfer_private
 * @param record - decrypted record plaintext from scanPrivateBalance
 */
export async function sendPrivate(
  privateKeyStr: string,
  recipient:     string,
  amountMicro:   bigint,
  record:        string,
  options:       TransactionOptions = {},
): Promise<TransactionResult> {
  validateInputs(privateKeyStr, recipient, amountMicro);
  if (!record) throw new Error('Record plaintext is required');

  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;
  await ensureThreadPool();

  const account     = new Account({ privateKey: privateKeyStr });
  const keyProvider = new AleoKeyProvider();
  keyProvider.useCache(true);
  const pm = new ProgramManager(rpcUrl, keyProvider, undefined);
  pm.setAccount(account);

  // record is passed as amountRecord (7th parameter)
  const tx = await pm.buildTransferTransaction(
    Number(amountMicro),
    recipient,
    'transfer_private',
    PRIORITY_FEE,
    false,
    undefined,
    record.replace(/\s+/g, ' ').trim(),
  );

  const txId = tx.id();
  const _nc = new AleoNetworkClient(rpcUrl);
  await _nc.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'private', true);
}

/**
 * transfer_private_to_public
 * @param record - decrypted record plaintext from scanPrivateBalance
 */
export async function sendPrivateToPublic(
  privateKeyStr: string,
  recipient:     string,
  amountMicro:   bigint,
  record:        string,
  options:       TransactionOptions = {},
): Promise<TransactionResult> {
  validateInputs(privateKeyStr, recipient, amountMicro);
  if (!record) throw new Error('Record plaintext is required');

  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;
  await ensureThreadPool();

  const account     = new Account({ privateKey: privateKeyStr });
  const keyProvider = new AleoKeyProvider();
  keyProvider.useCache(true);
  const pm = new ProgramManager(rpcUrl, keyProvider, undefined);
  pm.setAccount(account);

  const tx = await pm.buildTransferTransaction(
    Number(amountMicro),
    recipient,
    'transfer_private_to_public',
    PRIORITY_FEE,
    false,
    undefined,
    record.replace(/\s+/g, ' ').trim(),
  );

  const txId = tx.id();
  const _nc = new AleoNetworkClient(rpcUrl);
  await _nc.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'private_to_public', true);
}

// ══════════════════════════════════════════════════════════════════════════════
// RECORD MANAGEMENT — via relay (transitional)
// ══════════════════════════════════════════════════════════════════════════════

/** Split a private record into two. Uses the relay. */
export async function splitRecord(
  privateKeyStr:    string,
  record:           string,
  splitAmountMicro: bigint,
  options:          TransactionOptions = {},
): Promise<TransactionResult> {
  if (!privateKeyStr.startsWith('RPrivateKey1'))
    throw new Error('Invalid private key');
  if (!record) throw new Error('Record plaintext is required');

  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;
  const txId = await relayPost('record/split', {
    privateKey:       privateKeyStr,
    record:           record.replace(/\s+/g, ' ').trim(),
    splitAmountMicro: splitAmountMicro.toString(),
  }, relayUrl);

  return makeResult(txId, splitAmountMicro, '', 'private', false);
}

/** Join two private records into one. Uses the relay. */
export async function joinRecords(
  privateKeyStr: string,
  record1:       string,
  record2:       string,
  options:       TransactionOptions = {},
): Promise<TransactionResult> {
  if (!privateKeyStr.startsWith('RPrivateKey1'))
    throw new Error('Invalid private key');
  if (!record1 || !record2) throw new Error('Both record plaintexts are required');

  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;
  const txId = await relayPost('record/join', {
    privateKey: privateKeyStr,
    record1:    record1.replace(/\s+/g, ' ').trim(),
    record2:    record2.replace(/\s+/g, ' ').trim(),
  }, relayUrl);

  return makeResult(txId, 0n, '', 'private', false);
}

/** Estimated fee in microcredits (0.01 RICZ). */
export function estimateFee(): bigint {
  return 10_000n;
}
