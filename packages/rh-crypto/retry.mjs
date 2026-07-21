/**
 * robinhood-toolkit · retry policy for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/**
 * A request is safe to retry when repeating it cannot create a second effect.
 * GET is always safe. Order submission is safe ONLY because client_order_id
 * makes it idempotent; a POST without one is not.
 */
export function isRetryable({ method, status, body, idempotent }) {
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return method === 'GET' || idempotent === true;
  if (status === undefined) {
    // Network-level failure; the request may or may not have reached the server.
    return method === 'GET' || idempotent === true;
  }
  // 400/401/403/404/405/406/415 are deterministic. Retrying repeats the failure.
  void body;
  return false;
}

/** Full jitter exponential backoff, capped. */
export function backoffMs(attempt, { baseMs = 500, maxMs = 30_000 } = {}) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/** Honor a Retry-After header if the server sends one. */
export function retryAfterMs(headers) {
  const value = headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
