<!--
  robinhood-toolkit · build prompt: paper trading broker, the default mode
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 04 · Paper trading mode

## Goal

Build a paper broker that implements the same `Broker` port as the live broker,
fills against real live quotes, applies the same cost model as the backtester,
and is the mode the agent runs in unless someone deliberately turns it off.
Paper mode is where a strategy earns the right to touch real money.

## Prerequisites

- Prompts 01 to 03 completed. This prompt reuses `createCostModel` from
  `src/backtest/costs.mjs` so paper fills and backtest fills agree.
- Live market data access (REST quotes or the sequencer feed). Paper mode uses
  real prices; only the orders are simulated.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- Testnet chain 46630 is available for chain-side strategies. Testnet is not a
  substitute for paper mode against mainnet prices: testnet liquidity and prices
  are not real, so a strategy that works there tells you the code runs, not that
  the strategy works.
- 24/7 trading means paper mode should be run for a continuous multi-day window,
  including weekends. Weekend crypto liquidity differs from weekday liquidity and
  a Monday-to-Friday paper run hides that.

## Steps

1. Create `src/broker/paper.mjs` exporting a factory that returns an object
   satisfying the full `Broker` port: `placeOrder`, `getOrder`, `cancelOrder`,
   `getPositions`, `getBalances`. Same method names and same return shapes as
   the live broker in prompt 05. If the shapes drift, the flip to live becomes a
   rewrite and every bug in it is new.
2. Fill against the live quote, not the mid. A buy pays the ask plus modeled
   slippage; a sell receives the bid minus it. Filling at the mid is the paper
   equivalent of a zero-fee backtest.
3. Apply the same fee function the backtester uses. Import it; do not
   reimplement.
4. Model partial and rejected fills. Real venues reject orders for insufficient
   balance, size below minimum, and price band violations. A paper broker that
   fills 100 percent of everything trains you to write code with no rejection
   path, and that path executes for the first time in production.
5. Persist state to disk (`.paper-state.json`) so a restart does not reset the
   book. Restore positions, cash, and open orders on boot.
6. Add latency simulation. Real order acknowledgement is not instantaneous.
   Insert a configurable delay before the fill resolves so any code that assumes
   synchronous fills breaks in paper, where breaking is free.
7. Make paper mode loud. Prefix every log line with `[PAPER]` and print a
   session summary on shutdown. The failure mode you are guarding against is a
   human believing paper output was live, or the reverse.

```js
/**
 * robinhood-toolkit · paper broker
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createCostModel } from '../backtest/costs.mjs';

const STATE_FILE = process.env.PAPER_STATE_FILE ?? './.paper-state.json';

export default function createPaperBroker({
  startingCash = 10_000,
  costs = createCostModel({ takerFeeBps: 30, halfSpreadBps: 5 }),
  latencyMs = 250,
  minOrderNotional = 1,
  quotes,
} = {}) {
  let state = { cash: startingCash, positions: {}, orders: {}, fills: [], startedAt: new Date().toISOString() };

  async function persist() {
    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  }

  return {
    mode: 'paper',

    async init() {
      try {
        state = JSON.parse(await readFile(STATE_FILE, 'utf8'));
        console.log(`[PAPER] restored state: cash=${state.cash.toFixed(2)} fills=${state.fills.length}`);
      } catch {
        console.log(`[PAPER] fresh session, cash=${startingCash}`);
      }
      return this;
    },

    async placeOrder(intent) {
      await new Promise((r) => setTimeout(r, latencyMs));

      const quote = await quotes.getQuote(intent.symbol);
      const reference = intent.side === 'buy' ? quote.ask : quote.bid;
      const notional = intent.quantity * reference;

      const reject = (reason) => {
        const order = { ...intent, status: 'rejected', reason, ts: new Date().toISOString() };
        state.orders[intent.clientOrderId] = order;
        console.log(`[PAPER] REJECT ${intent.side} ${intent.symbol}: ${reason}`);
        return order;
      };

      if (notional < minOrderNotional) return reject('below_min_notional');
      if (intent.type === 'limit') {
        const marketable = intent.side === 'buy' ? intent.limitPrice >= quote.ask : intent.limitPrice <= quote.bid;
        if (!marketable) {
          const order = { ...intent, status: 'open', ts: new Date().toISOString() };
          state.orders[intent.clientOrderId] = order;
          await persist();
          return order; // resting, not filled
        }
      }

      const price = costs.fillPrice({
        side: intent.side,
        referencePrice: intent.type === 'limit' ? intent.limitPrice : reference,
        quantity: intent.quantity,
        barVolume: quote.size ?? Infinity,
      });
      const fee = costs.fee({ price, quantity: intent.quantity });
      const signed = intent.side === 'buy' ? intent.quantity : -intent.quantity;
      const cost = signed * price + fee;

      if (intent.side === 'buy' && cost > state.cash) return reject('insufficient_cash');
      if (intent.side === 'sell' && (state.positions[intent.symbol] ?? 0) < intent.quantity) {
        return reject('insufficient_position');
      }

      state.cash -= cost;
      state.positions[intent.symbol] = (state.positions[intent.symbol] ?? 0) + signed;

      const fill = {
        ...intent,
        status: 'filled',
        filledQuantity: intent.quantity,
        filledPrice: Number(price.toFixed(8)),
        fee: Number(fee.toFixed(8)),
        quoteAtDecision: quote,
        ts: new Date().toISOString(),
      };
      state.orders[intent.clientOrderId] = fill;
      state.fills.push(fill);
      await persist();

      console.log(
        `[PAPER] FILL ${intent.side} ${intent.quantity} ${intent.symbol} @ ${fill.filledPrice} fee=${fill.fee}`,
      );
      return fill;
    },

    async getOrder(clientOrderId) {
      return state.orders[clientOrderId] ?? null;
    },

    async cancelOrder(clientOrderId) {
      const order = state.orders[clientOrderId];
      if (!order || order.status !== 'open') return { clientOrderId, status: order?.status ?? 'not_found' };
      order.status = 'cancelled';
      await persist();
      return order;
    },

    async getPositions() {
      return { ...state.positions };
    },

    async getBalances() {
      return { USD: state.cash };
    },

    async summary() {
      const marks = await Promise.all(
        Object.keys(state.positions).map(async (s) => {
          const q = await quotes.getQuote(s);
          return state.positions[s] * ((q.bid + q.ask) / 2);
        }),
      );
      const equity = state.cash + marks.reduce((a, b) => a + b, 0);
      return {
        mode: 'paper',
        startedAt: state.startedAt,
        cash: Number(state.cash.toFixed(2)),
        equity: Number(equity.toFixed(2)),
        pnl: Number((equity - startingCash).toFixed(2)),
        fills: state.fills.length,
        feesPaid: Number(state.fills.reduce((a, f) => a + f.fee, 0).toFixed(2)),
      };
    },
  };
}
```

## Deliverable

- `src/broker/paper.mjs` implementing the full `Broker` port.
- Persistent `.paper-state.json`, added to `.gitignore`.
- `scripts/paper-report.mjs` printing the session summary.
- `test/paper-broker.test.js` covering rejection paths: below minimum notional,
  insufficient cash, insufficient position, and a non-marketable limit resting
  rather than filling.

## How to verify

```sh
cd packages/agent
node --test test/paper-broker.test.js
node src/main.mjs                 # defaults to paper, prints [PAPER] on every fill
node scripts/paper-report.mjs     # equity, PnL, fee total
```

Run for at least 72 continuous hours including a weekend before considering live
mode. Then compare the paper result to a backtest over the same window. If they
diverge materially, the backtest is wrong and you have just learned something
that would have cost real money to learn later.

## Gotchas

- Paper mode does not model market impact. Your simulated 10 BTC order does not
  move the book; a real one might. Paper results at size are optimistic.
- Paper mode does not model your own latency to the venue, API rate limits, or
  outages. Prompt 08 covers detecting those in production.
- The `.paper-state.json` file is a real accounting record for the simulation.
  Deleting it mid-run to "start fresh" destroys the comparison you were running.
- If paper mode and live mode ever return different object shapes, the flip to
  live is untested code on the critical path. Write one conformance test that
  runs the same assertions against both brokers.
- Never let the paper broker skip the policy engine. The point of paper mode is
  to exercise the whole pipeline, including its refusals.
