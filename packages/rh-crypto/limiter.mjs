/**
 * robinhood-toolkit · client-side token bucket
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
