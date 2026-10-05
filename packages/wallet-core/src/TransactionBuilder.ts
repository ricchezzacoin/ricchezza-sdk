/**
 * TransactionBuilder v0.5.0 — Production Secure
 *
 * Public transfers: signed LOCALLY in browser using WASM
 *   → Private key NEVER leaves the device
 *   → ZK proof generated in browser
 *   → Signed TX broadcast directly to chain
 *
 * Private transfers: still use relay (record format complexity)
 *   → TODO v0.6.0: move to full client-side signing
 *
 * Security model:
 *   sendPublic, sendPublicToPrivate → NO relay, fully client-side ✅
 *   sendPrivate, sendPrivateToPublic → relay (transitional) ⚠️
 *   splitRecord, joinRecords → relay (transitional) ⚠️
 */

import {
  ProgramManager,
  AleoKeyProvider,
  AleoNetworkClient,
  Account,
  initThreadPool,
} from '@ricchezza/sdk';

const DEFAULT_RPC     = 'https://rpc.testnet.riczscan.com';
const DEFAULT_RELAY   = 'https://rpc.testnet.ricchezzacoin.com/relay';
const EXPLORER_BASE   = 'https://explorer.testnet.riczscan.com';
const PRIORITY_FEE    = 10_000; // 0.01 RICZ

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
  signedLocally:      boolean; // true = production secure, false = relay used
}

// ── Thread pool (initialize once) ──────────────────────────────────────────
let _threadPoolReady = false;
async function ensureThreadPool(): Promise<void> {
  if (!_threadPoolReady) {
    await initThreadPool();
    _threadPoolReady = true;
  }
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
    feeMicrocredits:    BigInt(PRIORITY_FEE),
    recipient,
    transferType:       type,
    signedLocally,
  };
}

// ── Relay fallback (for private transfers) ──────────────────────────────────
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
// PUBLIC TRANSFERS — Fully client-side, production secure
// Private key never leaves the browser.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Send a public transfer (transfer_public).
 * ✅ PRODUCTION SECURE — signed locally, private key never sent anywhere.
 */
export async function sendPublic(
  privateKeyStr: string,
  recipient:     string,
  amountMicro:   bigint,
  options:       TransactionOptions = {},
): Promise<TransactionResult> {
  validateInputs(privateKeyStr, recipient, amountMicro);

  const rpcUrl = options.rpcUrl ?? DEFAULT_RPC;

  // Initialize WASM thread pool
  await ensureThreadPool();

  const account     = new Account({ privateKey: privateKeyStr });
  const keyProvider = new AleoKeyProvider();
  keyProvider.useCache(true);
  const pm = new ProgramManager(rpcUrl, keyProvider, undefined);
  pm.setAccount(account);

  // Build TX locally then submit — consistent with all other transfer types
  const tx = await pm.buildTransferTransaction(
    Number(amountMicro),
    recipient,
    'transfer_public',
    PRIORITY_FEE,
    false,
  );

  const txId = tx.id();
  await pm.networkClient.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'public', true);
}

/**
 * Send public-to-private (transfer_public_to_private).
 * ✅ PRODUCTION SECURE — signed locally, private key never sent anywhere.
 */
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
  await pm.networkClient.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'public_to_private', true);
}

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE TRANSFERS — Via relay (transitional, TODO: move to client-side v0.6.0)
// ⚠️ Private key sent over HTTPS to relay. Relay never stores it.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Send a private transfer (transfer_private).
 * ✅ PRODUCTION SECURE — signed locally, private key never sent anywhere.
 *
 * @param record - Decrypted record plaintext from scanPrivateBalance
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

  // Pass record as amountRecord (7th param)
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
  await pm.networkClient.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'private', true);
}

/**
 * Send private-to-public (transfer_private_to_public).
 * ✅ PRODUCTION SECURE — signed locally, private key never sent anywhere.
 *
 * @param record - Decrypted record plaintext from scanPrivateBalance
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
  await pm.networkClient.submitTransaction(tx.toString());

  return makeResult(txId, amountMicro, recipient, 'private_to_public', true);
}

// ══════════════════════════════════════════════════════════════════════════════
// RECORD MANAGEMENT — Via relay (transitional)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Split a private record into two.
 * ⚠️ Uses relay (transitional).
 */
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
    privateKey:      privateKeyStr,
    record:          record.replace(/\s+/g, ' ').trim(),
    splitAmountMicro: splitAmountMicro.toString(),
  }, relayUrl);

  return makeResult(txId, splitAmountMicro, '', 'private', false);
}

/**
 * Join two private records into one.
 * ⚠️ Uses relay (transitional).
 */
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
  return BigInt(PRIORITY_FEE);
}
