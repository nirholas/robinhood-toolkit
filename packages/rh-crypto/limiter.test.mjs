/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · token bucket tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { TokenBucket, BucketRegistry } from './limiter.mjs';

test('bucket drains and refills on a virtual clock', () => {
  let clock = 0;
  const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: () => clock });

  for (let i = 0; i < 5; i += 1) assert.equal(bucket.tryTake(), true);
  assert.equal(bucket.tryTake(), false, 'bucket must be empty');

  clock += 1000;
  assert.equal(bucket.tryTake(), true, 'one token after one second');

  clock += 60_000;
  assert.equal(bucket.available, 5, 'must not refill past capacity');
});

test('delayFor reports the wait accurately', () => {
  let clock = 0;
  const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 1, now: () => clock });
  bucket.tryTake();
  assert.equal(bucket.delayFor(1), 1000);
});

test('path templates share a bucket', () => {
  const registry = new BucketRegistry();
  const a = registry.for('/api/v1/crypto/trading/orders/11111111-1111-1111-1111-111111111111/cancel/');
  const b = registry.for('/api/v1/crypto/trading/orders/22222222-2222-2222-2222-222222222222/cancel/');
  assert.equal(a, b);
});

test('penalize forces a wait after a 429', () => {
  let clock = 0;
  const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 1, now: () => clock });
  bucket.penalize(2);
  assert.equal(bucket.tryTake(), false, 'empty and in debt after a penalty');
  // 2s of debt means ~3s until a single token is available again.
  assert.equal(bucket.delayFor(1), 3000);
  clock += 3000;
  assert.equal(bucket.tryTake(), true, 'recovers once the debt is refilled');
});

test('query strings do not fork the bucket key', () => {
  assert.equal(
    BucketRegistry.keyFor('/api/v1/crypto/trading/orders/?symbol=BTC-USD'),
    BucketRegistry.keyFor('/api/v1/crypto/trading/orders/?symbol=ETH-USD'),
  );
});
/* built by nirholas x.com/nichxbt */
