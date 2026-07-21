<!--
  robinhood-toolkit · build prompt: signal generation from chain and REST market data
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 02 · Signal generation

## Goal

Turn raw market data into a typed `Signal` object the loop from prompt 01 can
act on. You will build a bar aggregator, two reference indicators, a signal
envelope with confidence and reasoning attached, and a strict rule that a
strategy never reads a price it could not have known at decision time.

## Prerequisites

- Prompt 01 completed. This prompt implements the `Strategy` and `MarketData`
  ports.
- `npm i viem ws` inside `packages/agent`.
- For REST quotes, credentials from the Robinhood Crypto API. See track
  `20-crypto-api`. Chain-side signals need no credential.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>. Confirm the
  exact market data path and response field names against the live docs before
  you hardcode them; do not copy a shape out of a blog post.
- Block cadence around 101 ms means a naive per-block indicator has an extremely
  short memory. Aggregate into bars of a duration your strategy actually reasons
  about (1s, 5s, 1m) before computing anything.
- Robinhood operates the sequencer. The feed at
  `wss://feed.mainnet.chain.robinhood.com` reflects sequencer ordering, which is
  ahead of settlement finality on Ethereum. A signal derived from the feed is
  acting on soft-confirmed data. That is usually fine for trading and never fine
  for accounting.
- The venue runs 24/7. Indicator windows expressed in "days" have no session
  boundary to anchor to, so define windows in explicit durations and never
  assume a gap exists between "yesterday" and "today".

## Steps

1. Create `src/market/bars.mjs`. Implement a streaming bar aggregator that takes
   `(ts, price, size)` ticks and closes a bar every `bucketMs`. It must emit a
   bar only once the bucket is fully in the past. A bar that is still filling is
   the most common source of lookahead bias in a live-versus-backtest mismatch.
2. Create `src/market/indicators.mjs`. Implement `sma(values, n)` and
   `ema(values, n)` as pure functions over closed bars, plus `zscore` for a
   mean-reversion strategy. Return `null`, not a partial value, when there is
   insufficient history. Silently computing an SMA over 3 samples when you asked
   for 20 produces a strategy that trades garbage during its first minutes.
3. Create `src/strategy/momentum.mjs` implementing the `Strategy` port. Emit a
   `Signal` only on a state transition, not on every tick where the condition
   holds. The loop's cooldown is a backstop, not the primary de-duplication.
4. Attach reasoning to every signal. The `reason` field is what makes the audit
   journal in `80-safety/04` useful: months later you need to know why the bot
   bought, not just that it did.
5. Add a staleness gate. If the newest bar is older than `maxQuoteAgeMs`, return
   `null` and record the reason. A frozen feed that keeps returning its last
   value looks exactly like a flat market to an indicator.
6. Implement `src/market/quotes.mjs` with two sources behind one interface: the
   REST best bid/ask for venue pricing, and an on-chain pool read for chain
   pricing. Cross-check them and refuse to signal when they disagree beyond a
   threshold. Two independent sources disagreeing means one of them is wrong and
   you do not know which.

```js
/**
 * robinhood-toolkit · bar aggregation and indicators
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Shown as one block for readability. Split it as written in steps 1 and 2:
 * createBarAggregator into src/market/bars.mjs, the indicator functions into
 * src/market/indicators.mjs. Keep the attribution header on both files.
 */
export function createBarAggregator({ bucketMs = 60_000, maxBars = 500 } = {}) {
  const bars = [];
  let current = null;

  function bucketStart(ts) {
    return Math.floor(ts / bucketMs) * bucketMs;
  }

  return {
    /** Push a tick. Returns a closed bar when one completes, else null. */
    push({ ts, price, size = 0 }) {
      const start = bucketStart(ts);
      let closed = null;

      if (current && start > current.start) {
        closed = current;
        bars.push(closed);
        if (bars.length > maxBars) bars.shift();
        current = null;
      }
      if (!current) {
        current = { start, open: price, high: price, low: price, close: price, volume: size, ticks: 0 };
      }
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.volume += size;
      current.ticks += 1;
      return closed;
    },
    /** Closed bars only. The in-progress bar is never exposed. */
    closed() {
      return bars.slice();
    },
    lastClosed() {
      return bars.at(-1) ?? null;
    },
  };
}

export function sma(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return null;
  const window = values.slice(-n);
  return window.reduce((a, b) => a + b, 0) / n;
}

export function ema(values, n) {
  if (!Array.isArray(values) || values.length < n || n <= 0) return null;
  const k = 2 / (n + 1);
  let acc = sma(values.slice(0, n), n);
  for (const v of values.slice(n)) acc = v * k + acc * (1 - k);
  return acc;
}

export function zscore(values, n) {
  const mean = sma(values, n);
  if (mean === null) return null;
  const window = values.slice(-n);
  const variance = window.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  return (values.at(-1) - mean) / sd;
}
```

```js
/**
 * robinhood-toolkit · momentum crossover strategy
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { ema } from '../market/indicators.mjs';

export default function createMomentumStrategy({
  fast = 12,
  slow = 26,
  quantity = 0.001,
  maxQuoteAgeMs = 15_000,
} = {}) {
  const lastState = new Map();

  return {
    name: 'ema-crossover',
    params: { fast, slow, quantity },

    decide({ symbol, quote, bars, now = Date.now() }) {
      const closedBars = bars?.closed?.() ?? [];
      if (closedBars.length < slow) {
        return null; // insufficient history, not a hold signal
      }

      const last = closedBars.at(-1);
      if (now - (last.start + (last.duration ?? 0)) > maxQuoteAgeMs) {
        return null; // stale feed
      }

      const closes = closedBars.map((b) => b.close);
      const f = ema(closes, fast);
      const s = ema(closes, slow);
      if (f === null || s === null) return null;

      const state = f > s ? 'long' : 'flat';
      const prev = lastState.get(symbol);
      lastState.set(symbol, state);
      if (prev === undefined || prev === state) return null; // transitions only

      const spread = quote.ask - quote.bid;
      return {
        symbol,
        side: state === 'long' ? 'buy' : 'sell',
        type: 'limit',
        quantity,
        limitPrice: state === 'long' ? quote.ask : quote.bid,
        confidence: Math.min(1, Math.abs(f - s) / s * 100),
        reason: `ema${fast}=${f.toFixed(2)} crossed ${state === 'long' ? 'above' : 'below'} ema${slow}=${s.toFixed(2)}`,
        inputs: { fast: f, slow: s, bars: closedBars.length, spread, quoteTs: quote.ts },
        generatedAt: new Date(now).toISOString(),
      };
    },
  };
}
```

## Deliverable

- `src/market/bars.mjs`, `src/market/indicators.mjs`, `src/market/quotes.mjs`.
- `src/strategy/momentum.mjs` and `src/strategy/index.mjs` selecting a strategy
  by `AGENT_STRATEGY`.
- `test/indicators.test.js` with known-answer vectors for `sma`, `ema`,
  `zscore`, and a test asserting the aggregator never returns an open bar.

## How to verify

```sh
cd packages/agent
node --test test/indicators.test.js
node -e "
import('./src/market/bars.mjs').then(({createBarAggregator})=>{
  const a = createBarAggregator({ bucketMs: 1000 });
  console.log(a.push({ts:0,price:10}));      // null, first bar opens
  console.log(a.push({ts:500,price:12}));    // null, same bucket
  console.log(a.push({ts:1500,price:9}));    // closed bar {open:10,high:12,low:10,close:12}
  console.log(a.closed().length);            // 1, the open bar is excluded
});"
```

Then run the loop from prompt 01 with this strategy and confirm the journal
shows `state: "idle"` for the warm-up period rather than immediate trades.

## Gotchas

- **The in-progress bar is poison.** Indicators computed over it change within a
  bucket and will not reproduce in a backtest. Only ever read `closed()`.
- A crossover strategy that signals on every tick where `fast > slow` will fire
  hundreds of times per crossing. Track the previous state and emit on the
  transition. The cooldown in the loop hides this bug rather than fixing it.
- `zscore` returns 0 when standard deviation is 0. A perfectly flat feed is
  usually a broken feed, not a calm market. Add a separate flatline detector if
  your data source is unreliable.
- Do not let the strategy read wall-clock time internally. Inject `now` so the
  backtester in prompt 03 can replay history deterministically.
- Do not mix the sequencer feed's soft-confirmed prices with settled on-chain
  balances in the same calculation. They are different clocks.
- Confidence values are useful for sizing but only if calibrated. Do not wire
  `confidence` to position size until you have checked in a backtest that high
  confidence signals actually outperform low ones.
