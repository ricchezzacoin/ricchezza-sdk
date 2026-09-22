/**
 * ChainClient — read-only client for the Ricchezza chain.
 *
 * Talks to a Ricchezza RPC endpoint over HTTPS.
 * All methods return raw microcredit values as bigint.
 * Use format helpers to convert to RICZ strings for UI display.
 */

const DEFAULT_RPC_URL = 'https://rpc.testnet.riczscan.com';
const DEFAULT_TIMEOUT_MS = 10_000;

const CREDITS_PROGRAM = 'credits.aleo';

export interface ChainClientOptions {
  /** RPC base URL. Defaults to https://rpc.testnet.riczscan.com */
  rpcUrl?: string;
  /** Request timeout in ms. Defaults to 10 seconds. */
  timeoutMs?: number;
}

export class ChainClient {
  private readonly rpcUrl: string;
  private readonly timeoutMs: number;

  constructor(options: ChainClientOptions = {}) {
    this.rpcUrl = (options.rpcUrl ?? DEFAULT_RPC_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Get the current public balance for an address (in microcredits).
   * Returns 0n if the address has never received a public transfer.
   * Throws if the RPC is unreachable or returns an invalid response.
   */
  async getPublicBalance(address: string): Promise<bigint> {
    if (!address.startsWith('ricz1')) {
      throw new Error(`Invalid address: must start with ricz1 (got ${address.substring(0, 10)}...)`);
    }

    const url = `${this.rpcUrl}/testnet/program/${CREDITS_PROGRAM}/mapping/account/${address}`;
    const response = await this.fetchJson(url);

    // Chain returns null for addresses that never received funds
    if (response === null || response === 'null') {
      return 0n;
    }

    // Response format: "100000000u64" (string with u64 suffix)
    return this.parseU64(response);
  }

  /**
   * Get the current chain height (block number).
   */
  async getHeight(): Promise<number> {
    const url = `${this.rpcUrl}/testnet/block/height/latest`;
    const response = await this.fetchJson(url);
    return typeof response === 'number' ? response : parseInt(String(response), 10);
  }

  /**
   * Check if the RPC endpoint is reachable and responding.
   * Returns true on success, false on any failure. Never throws.
   */
  async isReachable(): Promise<boolean> {
    try {
      const height = await this.getHeight();
      return typeof height === 'number' && height >= 0;
    } catch {
      return false;
    }
  }

  /**
   * Placeholder for private balance. Will be implemented in the next version
   * once the record scanner is ready.
   */
  async getPrivateBalance(_viewKey: string): Promise<bigint> {
    throw new Error(
      'Not yet implemented — private balance requires the record scanner, coming in the next version'
    );
  }

  /**
   * Get the RPC URL this client is configured for.
   */
  getRpcUrl(): string {
    return this.rpcUrl;
  }

  // ─── internal ─────────────────────────────────────────────

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`RPC ${res.status}: ${res.statusText} at ${url}`);
      }
      const text = await res.text();
      // Chain responses are either JSON or a raw string (like "100u64" or a hash)
      try {
        return JSON.parse(text);
      } catch {
        return text.replace(/^"|"$/g, ''); // strip surrounding quotes if any
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`RPC timeout after ${this.timeoutMs}ms: ${url}`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private parseU64(raw: unknown): bigint {
    const str = String(raw);
    // Format may be "100000000u64" or "100000000" or just a number
    const match = str.match(/^(\d+)(?:u64)?$/);
    if (!match) {
      throw new Error(`Invalid u64 response: ${str}`);
    }
    return BigInt(match[1]);
  }
}
