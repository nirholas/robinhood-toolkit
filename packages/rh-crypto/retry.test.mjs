/**
 * robinhood-toolkit · retry policy tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isRetryable, backoffMs, retryAfterMs } from './retry.mjs';

test('429 is always retryable', () => {
  assert.equal(isRetryable({ method: 'POST', status: 429 }), true);
  assert.equal(isRetryable({ method: 'GET', status: 429 }), true);
});

test('5xx retries GET, but POST only when idempotent', () => {
  assert.equal(isRetryable({ method: 'GET', status: 503 }), true);
  assert.equal(isRetryable({ method: 'POST', status: 503 }), false);
  assert.equal(isRetryable({ method: 'POST', status: 503, idempotent: true }), true);
});

test('network-level failure (no status) follows the same idempotency rule', () => {
  assert.equal(isRetryable({ method: 'GET', status: undefined }), true);
  assert.equal(isRetryable({ method: 'POST', status: undefined }), false);
  assert.equal(isRetryable({ method: 'POST', status: undefined, idempotent: true }), true);
});

test('deterministic 4xx is never retried', () => {
  for (const status of [400, 401, 403, 404, 405, 406, 415]) {
    assert.equal(isRetryable({ method: 'GET', status }), false, `status ${status}`);
    assert.equal(
      isRetryable({ method: 'POST', status, idempotent: true }),
      false,
      `status ${status} even when idempotent`,
    );
  }
});

test('backoff stays within the full-jitter window and honors the cap', () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const ms = backoffMs(attempt, { baseMs: 500, maxMs: 30_000 });
    assert.ok(ms >= 0, 'never negative');
    assert.ok(ms <= 30_000, 'never above the cap');
    assert.ok(ms < Math.min(30_000, 500 * 2 ** attempt) || ms === 0, 'within the per-attempt ceiling');
  }
});

test('retryAfterMs reads numeric seconds and missing headers', () => {
  const headers = new Map([['retry-after', '5']]);
  assert.equal(retryAfterMs(headers), 5000);
  assert.equal(retryAfterMs(new Map()), null);
  assert.equal(retryAfterMs(undefined), null);
});

test('retryAfterMs parses an HTTP-date', () => {
  const future = new Date(Date.now() + 10_000).toUTCString();
  const headers = new Map([['retry-after', future]]);
  const ms = retryAfterMs(headers);
  assert.ok(ms > 0 && ms <= 10_000, `expected ~10s, got ${ms}`);
});
