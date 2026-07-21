<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: rate limiting and retry policy
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 07 · Rate limits and retries

## Goal

Wrap the client in a client-side token bucket and a retry policy that knows which
requests are safe to repeat. After this prompt, no code path in the toolkit can
accidentally exceed the published budget or double-submit an order.

## Prerequisites

- Prompt 01 (`packages/rh-crypto/client.mjs`).
- Prompt 03, because idempotency of order submission is the crux of retry safety.

## Reference facts

Quoted from the Rate Limiting section of the live spec, verified 2026-07-20:

- Requests per minute per user account: **100**
- Requests per minute per user account in bursts: **300**

Mechanism, in Robinhood's own terms:

> Rate limiting is applied using a token bucket implementation. The burst size or
> `capacity` is the number of tokens you can use to call an endpoint. This
> capacity is initialized at the maximum capacity and will be refilled using a
> `refill amount` at a timed interval called `refill interval` until the max
> capacity is once again reached.

| Term | Meaning |
|---|---|
| Max capacity | Maximum tokens allowed; refill stops here |
| Remaining amount | Tokens left that can be consumed |
| Refill amount | Tokens added each refill interval |
| Refill interval | How often tokens are added |

Two facts that shape the design:

1. **Limits are applied per endpoint and differ between endpoints** depending on
   expected use case.
2. **The actual configuration fluctuates** with service availability and expected
   volume. The published numbers are the budget you plan against, not a constant
   you can pin.

Exceeding the limit returns HTTP **429**. The spec does not publish a
`Retry-After` header or rate-limit headers for these endpoints. UNVERIFIED: check
your own 429 responses for `retry-after`, `x-ratelimit-remaining`, or similar and
honor them if present. Discover it with:

```sh
curl -s -D - -o /dev/null "https://trading.robinhood.com/api/v1/crypto/trading/accounts/" \
  -H "x-api-key: $RH_API_KEY" -H "x-timestamp: ..." -H "x-signature: ..."
```

Inspect every response header once, not just on failure. If a rate-limit header
exists, prefer it over any client-side estimate.

## Steps

1. Write `packages/rh-crypto/limiter.mjs`:

```js
/**
 * robinhood-toolkit · client-side token bucket
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export class TokenBucket {
  #tokens;
  #lastRefill;

  /**
   * Defaults model the published budget: burst to 300, refill to a sustained
   * 100 per minute. Stay under, not at, the limit.
   */
  constructor({ capacity = 300, refillPerSecond = 100 / 60, now = () => Date.now() } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.now = now;
    this.#tokens = capacity;
    this.#lastRefill = now();
  }

  #refill() {
    const t = this.now();
    const elapsedSeconds = (t - this.#lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsedSeconds * this.refillPerSecond);
    this.#lastRefill = t;
  }

  get available() {
    this.#refill();
    return this.#tokens;
  }

  /** Milliseconds until `count` tokens are available. 0 if available now. */
  delayFor(count = 1) {
    this.#refill();
    if (this.#tokens >= count) return 0;
    return Math.ceil(((count - this.#tokens) / this.refillPerSecond) * 1000);
  }

  tryTake(count = 1) {
    this.#refill();
    if (this.#tokens < count) return false;
    this.#tokens -= count;
    return true;
  }

  /** Wait until tokens are available, then consume them. */
  async take(count = 1) {
    for (;;) {
      const delay = this.delayFor(count);
      if (delay === 0 && this.tryTake(count)) return;
      await new Promise((r) => setTimeout(r, delay || 5));
    }
  }

  /** Force the bucket empty after a 429, so the next call waits. */
  penalize(seconds = 1) {
    this.#refill();
    this.#tokens = Math.min(this.#tokens, 0) - seconds * this.refillPerSecond;
  }
}

/** Per-endpoint buckets, because limits are applied per endpoint. */
export class BucketRegistry {
  #buckets = new Map();

  constructor(options = {}) {
    this.options = options;
  }

  /** Group by path template so `/orders/{id}/cancel/` shares one bucket. */
  static keyFor(path) {
    return path
      .split('?')[0]
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//gi, '/{id}/');
  }

  for(path) {
    const key = BucketRegistry.keyFor(path);
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.options);
      this.#buckets.set(key, bucket);
    }
    return bucket;
  }
}
```

2. Write `packages/rh-crypto/retry.mjs`:

```js
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
```

3. Wire both into the client. Add to `RobinhoodCrypto`:

```js
/**
 * robinhood-toolkit · rate-limited, retrying request wrapper
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { BucketRegistry } from './limiter.mjs';
import { backoffMs, isRetryable, retryAfterMs } from './retry.mjs';

// Inside the class:
//   this.buckets = new BucketRegistry();
//   this.maxAttempts = 5;

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
```

To make `retryAfterMs` useful, attach the response headers to the thrown error in
`request()`:

```js
if (!res.ok) {
  const err = new Error(`Robinhood ${res.status} on ${method} ${fullPath}`);
  err.status = res.status;
  err.body = parsed;
  err.headers = res.headers;   // add this line
  throw err;
}
```

4. Mark order submission idempotent at the call site, and only there:

```js
// Safe: the same client_order_id makes a repeat submission a no-op server-side.
const body = buildOrder({ symbol, side, type, config });      // generates the UUID once
await rh.requestWithPolicy('POST', '/api/v1/crypto/trading/orders/', { body, idempotent: true });
```

The UUID must be generated **outside** the retry loop. `buildOrder` above does
this correctly because the body is built once and passed in.

## Deliverable

- `packages/rh-crypto/limiter.mjs` exporting `TokenBucket` and `BucketRegistry`
- `packages/rh-crypto/retry.mjs` exporting `isRetryable`, `backoffMs`,
  `retryAfterMs`
- `requestWithPolicy` on `RobinhoodCrypto`, with `headers` attached to errors
- Tests using an injected clock, so they run instantly and offline

## How to verify

```sh
node --test packages/rh-crypto/limiter.test.mjs
```

The test must cover, with an injected `now`:

```js
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
```

Then verify live: run the prompt 06 stream for 5 minutes with the limiter in
place and confirm you never see a 429. Separately, deliberately hammer a read
endpoint with the limiter disabled until you get one 429, and confirm your
handler backs off rather than retrying immediately.

## Gotchas

- **Never retry an order POST without `client_order_id` reuse.** This is the one
  gotcha in this file that costs real money. A retry that generates a fresh UUID
  is a second real order. Generate the UUID once, outside the loop, and pass the
  same body to every attempt.
- **Re-sign on every attempt.** Replaying the original headers fails once the
  30-second timestamp window expires, turning a retryable 503 into a confusing
  401. The wrapper above calls `request()` fresh each attempt for this reason.
- **A network-level failure is ambiguous.** The request may have reached
  Robinhood and executed. Only retry it if it is idempotent; otherwise reconcile
  by listing orders filtered on your `client_order_id` and check before acting.
- **Do not retry 400, 401, 403, 404, 415.** They are deterministic. Retrying
  burns budget and delays the real error reaching you.
- **Limits are per endpoint and change over time.** A single global bucket either
  over-restricts reads or under-restricts a hot endpoint. `BucketRegistry` keys
  per path template, and the published numbers are a planning budget, not a
  guarantee.
- **Full jitter, not fixed backoff.** Multiple processes on the same account
  retrying on identical schedules re-collide forever. `backoffMs` randomizes
  across the whole window.
- **Budget is per account, not per process.** Two bots on one credential share
  100 requests per minute. Client-side buckets in separate processes do not know
  about each other. If you run more than one, either give each a fixed share of
  the budget or put them behind one shared gateway process.
<!-- built by nirholas x.com/nichxbt -->
