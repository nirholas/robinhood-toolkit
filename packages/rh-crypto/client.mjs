/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · authenticated client for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { authHeaders, loadPrivateKey } from './sign.mjs';
import { toRobinhoodError } from './errors.mjs';
import { BucketRegistry } from './limiter.mjs';
import { backoffMs, isRetryable, retryAfterMs } from './retry.mjs';

const BASE_URL = 'https://trading.robinhood.com';

/**
 * The single source of truth for which endpoint set order placement uses.
 * Decided deliberately in prompt 05 and explained in README.md ("v1 versus v2").
 * Later prompts read this constant instead of rediscovering the choice, so the
 * decision lives in exactly one place. Read actions exist on both versions;
 * only this affects where orders are posted and whether they accrue fee-tier
 * 30-day volume (v2 only).
 */
export const ORDER_API_VERSION = 'v1';

export class RobinhoodCrypto {
  constructor({ apiKey = process.env.RH_API_KEY, privateKey = process.env.RH_PRIVATE_KEY } = {}) {
    if (!apiKey) throw new Error('RH_API_KEY is not set');
    if (!privateKey) throw new Error('RH_PRIVATE_KEY is not set');
    this.apiKey = apiKey;
    this.privateKey = loadPrivateKey(privateKey);
    this.buckets = new BucketRegistry();
    this.maxAttempts = 5;
  }

  /**
   * @param path path with no query string, e.g. "/api/v1/crypto/trading/holdings/"
   * @param query object of query params; array values repeat the key
   * @param body plain object, or undefined
   */
  async request(method, path, { query, body } = {}) {
    const search = buildQuery(query);
    const fullPath = path + search;

    // Serialize exactly once. This same string is signed and transmitted.
    const payload = body === undefined ? '' : JSON.stringify(body);

    const headers = {
      ...authHeaders({
        apiKey: this.apiKey,
        privateKey: this.privateKey,
        method,
        path: fullPath,
        body: payload,
      }),
      'Content-Type': 'application/json',
    };

    const res = await fetch(BASE_URL + fullPath, {
      method: method.toUpperCase(),
      headers,
      body: payload === '' ? undefined : payload,
    });

    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!res.ok) {
      throw toRobinhoodError({
        status: res.status,
        payload: parsed,
        method: method.toUpperCase(),
        path: fullPath,
        headers: res.headers,
      });
    }
    return parsed;
  }

  /**
   * Rate-limited, retrying wrapper around request(). Consumes one token from the
   * per-endpoint bucket before each attempt and retries only failures that are
   * safe to repeat. Re-signs on every attempt because the timestamp window is
   * 30 seconds; replaying old headers would turn a retryable 503 into a 401.
   *
   * @param idempotent set true only when the body carries a reused client_order_id.
   */
  async requestWithPolicy(method, path, { query, body, idempotent, maxAttempts = this.maxAttempts } = {}) {
    const bucket = this.buckets.for(path);
    let lastError = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await bucket.take(1);
      try {
        // Re-sign on every attempt: the timestamp is only valid for 30 seconds.
        return await this.request(method, path, { query, body });
      } catch (error) {
        lastError = error;
        const status = error.status;

        if (status === 429) bucket.penalize(2);
        if (!isRetryable({ method, status, body: error.body, idempotent })) throw error;
        if (attempt === maxAttempts - 1) break;

        const serverDelay = retryAfterMs(error.headers);
        await new Promise((r) => setTimeout(r, serverDelay ?? backoffMs(attempt)));
      }
    }
    throw lastError;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body, query) {
    return this.request('POST', path, { body, query });
  }
}

/** Repeats a key for array values: {symbol:['BTC-USD','ETH-USD']} -> ?symbol=BTC-USD&symbol=ETH-USD */
export function buildQuery(query) {
  if (!query) return '';
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
/* built by nirholas x.com/nichxbt */
