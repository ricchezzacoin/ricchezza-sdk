/**
 * TransactionBuilder v0.4.0
 * Sends all 4 transfer types via Relay API on client-rpc.
 *
 * transfer_public           — public balance → public balance
 * transfer_public_to_private — public balance → private record
 * transfer_private          — private record → private record
 * transfer_private_to_public — private record → public balance
 */

const DEFAULT_RELAY = 'https://rpc.testnet.ricchezzacoin.com/relay';

export interface TransactionOptions {
  feeRicz?: number;
  relayUrl?: string;
}

export interface TransactionResult {
  txId: string;
  explorerUrl: string;
  amountMicrocredits: bigint;
  feeMicrocredits: bigint;
  recipient: string;
  transferType: 'public' | 'public_to_private' | 'private' | 'private_to_public';
}

async function relayPost(
  endpoint: string,
  payload: Record<string, string>,
  relayUrl: string
): Promise<TransactionResult> {
  const res = await fetch(`${relayUrl}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json() as any;
  if (!res.ok || !data.txId)
    throw new Error(`Transaction failed: ${data.error ?? JSON.stringify(data)}`);

  return data;
}

function validatePublicInputs(privateKeyStr: string, recipient: string, amountMicro: bigint) {
  if (!privateKeyStr.startsWith('RPrivateKey1'))
    throw new Error('Invalid private key — must start with RPrivateKey1');
  if (!recipient.startsWith('ricz1'))
    throw new Error('Invalid recipient address — must start with ricz1');
  if (amountMicro <= 0n)
    throw new Error('Amount must be greater than 0');
}

/**
 * Send a public transfer (transfer_public).
 * Public balance → Public balance. Both visible on-chain.
 */
export async function sendPublic(
  privateKeyStr: string,
  recipient: string,
  amountMicro: bigint,
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  validatePublicInputs(privateKeyStr, recipient, amountMicro);
  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;

  const data = await relayPost('transfer/public', {
    privateKey: privateKeyStr,
    recipient,
    amountMicro: amountMicro.toString(),
  }, relayUrl);

  return {
    txId: data.txId,
    explorerUrl: data.explorerUrl,
    amountMicrocredits: amountMicro,
    feeMicrocredits: 1_000_000n,
    recipient,
    transferType: 'public',
  };
}

/**
 * Send a public-to-private transfer (transfer_public_to_private).
 * Public balance → Encrypted private record for recipient.
 * Amount is hidden from public view after transfer.
 */
export async function sendPublicToPrivate(
  privateKeyStr: string,
  recipient: string,
  amountMicro: bigint,
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  validatePublicInputs(privateKeyStr, recipient, amountMicro);
  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;

  const data = await relayPost('transfer/public-to-private', {
    privateKey: privateKeyStr,
    recipient,
    amountMicro: amountMicro.toString(),
  }, relayUrl);

  return {
    txId: data.txId,
    explorerUrl: data.explorerUrl,
    amountMicrocredits: amountMicro,
    feeMicrocredits: 1_000_000n,
    recipient,
    transferType: 'public_to_private',
  };
}

/**
 * Send a private transfer (transfer_private).
 * Private record → Private record for recipient.
 * Fully private — sender, recipient, amount all hidden.
 *
 * @param record - Decrypted record plaintext from RecordScanner
 */
export async function sendPrivate(
  privateKeyStr: string,
  recipient: string,
  amountMicro: bigint,
  record: string,
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  validatePublicInputs(privateKeyStr, recipient, amountMicro);
  if (!record) throw new Error('Record plaintext is required for private transfer');
  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;

  // Compact record to single line — newlines break JSON in relay
  const recordCompact = record.replace(/\s+/g, ' ').trim();
  const data = await relayPost('transfer/private', {
    privateKey: privateKeyStr,
    recipient,
    amountMicro: amountMicro.toString(),
    record: recordCompact,
  }, relayUrl);

  return {
    txId: data.txId,
    explorerUrl: data.explorerUrl,
    amountMicrocredits: amountMicro,
    feeMicrocredits: 1_000_000n,
    recipient,
    transferType: 'private',
  };
}

/**
 * Send a private-to-public transfer (transfer_private_to_public).
 * Private record → Public balance for recipient.
 * Converts private funds to public.
 *
 * @param record - Decrypted record plaintext from RecordScanner
 */
export async function sendPrivateToPublic(
  privateKeyStr: string,
  recipient: string,
  amountMicro: bigint,
  record: string,
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  validatePublicInputs(privateKeyStr, recipient, amountMicro);
  if (!record) throw new Error('Record plaintext is required for private-to-public transfer');
  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;

  const recordCompact = record.replace(/\s+/g, ' ').trim();
  const data = await relayPost('transfer/private-to-public', {
    privateKey: privateKeyStr,
    recipient,
    amountMicro: amountMicro.toString(),
    record: recordCompact,
  }, relayUrl);

  return {
    txId: data.txId,
    explorerUrl: data.explorerUrl,
    amountMicrocredits: amountMicro,
    feeMicrocredits: 1_000_000n,
    recipient,
    transferType: 'private_to_public',
  };
}

/** Estimated fee in microcredits (1 RICZ priority fee). */
export function estimateFee(): bigint {
  return 1_000_000n;
}

/**
 * Split a private record into two smaller records.
 * Useful for making exact payments from private balance.
 * Note: 10,000 microcredits (0.01 RICZ) is deducted as split fee.
 *
 * @param record         - Decrypted record plaintext from scanPrivateBalance
 * @param splitAmountMicro - Amount for first record (remainder goes to second)
 */
export async function splitRecord(
  privateKeyStr: string,
  record: string,
  splitAmountMicro: bigint,
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  if (!privateKeyStr.startsWith('RPrivateKey1'))
    throw new Error('Invalid private key');
  if (!record) throw new Error('Record plaintext is required');
  if (splitAmountMicro <= 0n) throw new Error('Split amount must be greater than 0');

  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;
  const recordCompact = record.replace(/\s+/g, ' ').trim();

  const res = await fetch(`${relayUrl}/record/split`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: privateKeyStr,
      record: recordCompact,
      splitAmountMicro: splitAmountMicro.toString(),
    }),
  });

  const data = await res.json() as any;
  if (!res.ok || !data.txId)
    throw new Error(`Split failed: ${data.error ?? JSON.stringify(data)}`);

  return {
    txId: data.txId,
    explorerUrl: data.explorerUrl,
    amountMicrocredits: splitAmountMicro,
    feeMicrocredits: 1_000_000n,
    recipient: '',
    transferType: 'private',
  };
}

/**
 * Join two private records into one.
 * Useful for consolidating multiple small records into one spendable record.
 * Both records must be owned by the same address.
 *
 * @param record1 - First record plaintext from scanPrivateBalance
 * @param record2 - Second record plaintext from scanPrivateBalance
 */
export async function joinRecords(
  privateKeyStr: string,
  record1: string,
  record2: string,
  options: TransactionOptions = {}
): Promise<TransactionResult> {
  if (!privateKeyStr.startsWith('RPrivateKey1'))
    throw new Error('Invalid private key');
  if (!record1 || !record2) throw new Error('Both record plaintexts are required');

  const relayUrl = options.relayUrl ?? DEFAULT_RELAY;

  const res = await fetch(`${relayUrl}/record/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      privateKey: privateKeyStr,
      record1: record1.replace(/\s+/g, ' ').trim(),
      record2: record2.replace(/\s+/g, ' ').trim(),
    }),
  });

  const data = await res.json() as any;
  if (!res.ok || !data.txId)
    throw new Error(`Join failed: ${data.error ?? JSON.stringify(data)}`);

  return {
    txId: data.txId,
    explorerUrl: data.explorerUrl,
    amountMicrocredits: 0n,
    feeMicrocredits: 1_000_000n,
    recipient: '',
    transferType: 'private',
  };
}
