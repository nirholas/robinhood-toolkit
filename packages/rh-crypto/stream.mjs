/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · polling stream with a push-style interface
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { EventEmitter } from 'node:events';
import { bestBidAsk } from './marketdata.mjs';
import { isTerminal } from './lifecycle.mjs';

/**
 * Emits:
 *   'quote'  (symbol, quote, previous)  only when the quote actually moved
 *   'order'  (order, previous)          only when state or filled quantity moved
 *   'error'  (error)
 *   'idle'                              a poll completed with no changes
 *
 * There is no published WebSocket for the Robinhood Crypto Trading API, so this
 * presents a streaming interface over a poller. A future socket implementation
 * can be swapped in behind the same events and async iterator without touching
 * callers. See README for the check that confirms the poller is still correct.
 */
export class RobinhoodStream extends EventEmitter {
  #timer = null;
  #stopped = false;
  #lastQuote = new Map();
  #lastOrder = new Map();
  #failures = 0;

  constructor(rh, { symbols = [], intervalMs = 2_000, watchOrders = true, maxIntervalMs = 60_000 } = {}) {
    super();
    this.rh = rh;
    this.symbols = [...symbols];
    this.baseIntervalMs = intervalMs;
    this.maxIntervalMs = maxIntervalMs;
    this.watchOrders = watchOrders;
  }

  start() {
    if (this.#timer) return this;
    this.#stopped = false;
    this.#schedule(0);
    return this;
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = null;
  }

  addSymbol(symbol) {
    if (!this.symbols.includes(symbol)) this.symbols.push(symbol);
  }

  removeSymbol(symbol) {
    this.symbols = this.symbols.filter((s) => s !== symbol);
    this.#lastQuote.delete(symbol);
  }

  #schedule(delay) {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => void this.#tick(), delay);
  }

  async #tick() {
    let changed = false;
    try {
      if (this.symbols.length) changed = (await this.#pollQuotes()) || changed;
      if (this.watchOrders) changed = (await this.#pollOrders()) || changed;
      this.#failures = 0;
      if (!changed) this.emit('idle');
      this.#schedule(this.baseIntervalMs);
    } catch (error) {
      this.#failures += 1;
      this.emit('error', error);
      // Exponential backoff with a ceiling. 429s and 5xx both land here.
      const delay = Math.min(this.baseIntervalMs * 2 ** this.#failures, this.maxIntervalMs);
      this.#schedule(delay);
    }
  }

  async #pollQuotes() {
    const book = await bestBidAsk(this.rh, this.symbols);
    let changed = false;
    for (const [symbol, quote] of book) {
      const previous = this.#lastQuote.get(symbol);
      if (previous && previous.timestamp === quote.timestamp && previous.price === quote.price) continue;
      this.#lastQuote.set(symbol, quote);
      this.emit('quote', symbol, quote, previous ?? null);
      changed = true;
    }
    return changed;
  }

  async #pollOrders() {
    // One request covers every open order, rather than one request per order.
    const page = await this.rh.get('/api/v1/crypto/trading/orders/', { state: 'open', limit: 100 });
    const seen = new Set();
    let changed = false;

    for (const order of page.results ?? []) {
      seen.add(order.id);
      const previous = this.#lastOrder.get(order.id);
      if (previous && previous.state === order.state && previous.filled_asset_quantity === order.filled_asset_quantity) continue;
      this.#lastOrder.set(order.id, order);
      this.emit('order', order, previous ?? null);
      changed = true;
    }

    // An order that was open and is no longer in the open list reached a
    // terminal state. Fetch it once to learn which.
    for (const id of [...this.#lastOrder.keys()]) {
      if (seen.has(id)) continue;
      const previous = this.#lastOrder.get(id);
      this.#lastOrder.delete(id);
      if (previous && isTerminal(previous.state)) continue;
      const final = await this.rh.get('/api/v1/crypto/trading/orders/', { id });
      const order = (final.results ?? [])[0];
      if (order) {
        this.emit('order', order, previous ?? null);
        changed = true;
      }
    }
    return changed;
  }

  /** Async iterator over quote events, for `for await` consumers. */
  async *quotes({ signal } = {}) {
    const queue = [];
    let notify = null;
    const onQuote = (symbol, quote) => {
      queue.push({ symbol, quote });
      notify?.();
    };
    this.on('quote', onQuote);
    try {
      for (;;) {
        if (signal?.aborted) return;
        while (queue.length) yield queue.shift();
        await new Promise((resolve) => {
          notify = resolve;
          signal?.addEventListener('abort', resolve, { once: true });
        });
        notify = null;
      }
    } finally {
      this.off('quote', onQuote);
    }
  }
}
