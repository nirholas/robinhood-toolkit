<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: streaming market and order data
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 06 · Streaming market and order data

## Goal

Give your application a push-style stream of quotes and order updates, behind an
interface that will not change if Robinhood ever ships a real socket.

Read the reference facts before you write any code. The honest starting point is
that the thing this file is named after does not exist yet.

## Prerequisites

- Prompts 01, 02, and 04 complete.
- Prompt 07 (rate limits) is a hard dependency in practice: a poller is the
  fastest way to burn your request budget.

## Reference facts

**There is no published WebSocket or streaming endpoint for the Robinhood Crypto
Trading API.** Verified on 2026-07-20 against the full OpenAPI 3.0.1 spec served
at <https://docs.robinhood.com/crypto/trading>: the spec declares exactly 14
paths, all of them HTTP GET or POST under `https://trading.robinhood.com`, and
contains zero occurrences of `websocket`, `wss://`, `stream`, or `subscribe`.
There is no `webhooks` section and no callback declarations.

Do not take this as proof that no socket exists anywhere behind Robinhood's
consumer apps. It is proof that no socket is **published or supported** for this
API. Building against an unpublished internal socket means building on something
that can change without notice and may violate your customer agreement.

So this prompt builds a poller that presents a streaming interface. That is a
real implementation, not a placeholder: it emits events, it deduplicates, it
backs off, and it is the correct architecture given the published surface.

The relevant budget, from the spec's Rate Limiting section: 100 requests per
minute per user account, with bursts to 300, enforced as a token bucket per
endpoint. A single symbol polled once per second is 60 requests per minute, which
is 60 percent of your steady-state budget for one symbol. Poll accordingly.

### How to check whether this has changed

Do this before you assume the poller is still the right answer:

```sh
# 1. Does the published spec mention streaming at all?
curl -s https://docs.robinhood.com/crypto/trading/ \
  | grep -o '/_next/static/chunks/pages/crypto/trading-[a-f0-9]*\.js'
# fetch that chunk and grep it:
curl -s "https://docs.robinhood.com<chunk path from above>" \
  | grep -c -e websocket -e 'wss://' -e subscribe
# A non-zero count means the surface changed. Re-read the docs.
```

The spec is embedded in that page chunk as a JSON string, which is also how the
endpoint tables in this track were verified.

## Steps

1. Write `packages/rh-crypto/stream.mjs`. The public interface is an async
   iterator plus an event callback, so a future socket implementation can be
   swapped in without touching callers.

```js
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
 *   'quote'  (symbol, quote)   only when the quote actually moved
 *   'order'  (order, previous) only when state or filled quantity moved
 *   'error'  (error)
 *   'idle'                     a poll completed with no changes
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
```

2. Write `examples/rh-stream.mjs`:

```js
/**
 * robinhood-toolkit · tail live quotes and order updates
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';
import { RobinhoodStream } from '../packages/rh-crypto/stream.mjs';

const symbols = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const rh = new RobinhoodCrypto();
const stream = new RobinhoodStream(rh, {
  symbols: symbols.length ? symbols : ['BTC-USD', 'ETH-USD'],
  intervalMs: 2_000,
});

stream.on('quote', (symbol, q) => {
  console.log(`${q.timestamp} ${symbol} bid=${q.bid_inclusive_of_sell_spread} ask=${q.ask_inclusive_of_buy_spread}`);
});
stream.on('order', (order, previous) => {
  console.log(`order ${order.id} ${previous?.state ?? 'new'} -> ${order.state} filled=${order.filled_asset_quantity}`);
});
stream.on('error', (error) => console.error(`poll failed: ${error.message}`));

process.on('SIGINT', () => {
  stream.stop();
  process.exit(0);
});

stream.start();
```

3. Budget the poll interval explicitly. Two endpoints polled every 2 seconds is
   60 requests per minute total, regardless of how many symbols you watch,
   because both polls batch. Adding a per-order poll loop breaks that property,
   which is why `#pollOrders` uses one list call.

## Deliverable

- `packages/rh-crypto/stream.mjs` exporting `RobinhoodStream`
- `examples/rh-stream.mjs`
- A short section in `packages/rh-crypto/README.md` stating plainly that no
  published socket exists, so nobody re-litigates it later, plus the check
  command above

## How to verify

```sh
node --env-file=.env examples/rh-stream.mjs BTC-USD ETH-USD
```

- Quote lines appear and the timestamps advance.
- Identical consecutive quotes do **not** print, proving deduplication works.
- Place a resting limit order in another terminal; an `order` line appears within
  one poll interval, and a second line appears when you cancel it.
- Pull your network cable or set an invalid API key mid-run: `poll failed` lines
  appear with a visibly widening gap between them, proving backoff.
- Let it run 5 minutes and count requests. It must be at or under 60 per minute.

## Gotchas

- **Do not build against an unpublished socket.** If you find one by inspecting
  app traffic, it is not covered by the documented API, can change without
  notice, and using it is a customer-agreement question, not an engineering one.
- **One list poll, not N order polls.** The natural implementation polls each
  tracked order individually and multiplies your request count by the number of
  open orders. `state=open` returns all of them in one request.
- **An order disappearing from `state=open` is information.** It means terminal,
  not deleted. Handle the transition explicitly, as `#pollOrders` does, or you
  will silently miss every fill.
- **Deduplicate on `timestamp`, not on object identity.** Every poll returns a
  fresh object, so a naive change check fires constantly and floods consumers.
- **Back off on every failure class, not just 429.** A 503 answered with the same
  poll rate turns a brief outage into a rate-limit ban. Prompt 07 covers the
  policy; this stream defers to it.
- **The poller is not a tick feed.** You see the state of the book at poll time,
  not every trade. A strategy that assumes it sees every price move is wrong at
  any polling interval. Design around snapshots.
- **`setInterval` is the wrong primitive here.** If one poll takes longer than
  the interval, `setInterval` stacks overlapping requests and blows the budget.
  This implementation schedules the next poll only after the previous completes.
<!-- built by nirholas x.com/nichxbt -->
