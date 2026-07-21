<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: an honest backtesting harness
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 03 · Backtesting harness

## Goal

Replay historical bars through the exact `Strategy` implementation the live loop
uses, with fees and slippage modeled, and emit a report that states its own
assumptions. The harness must make lookahead bias structurally impossible rather
than merely discouraged.

## Prerequisites

- Prompts 01 and 02 completed. The harness imports the same strategy module the
  live loop imports. If you write a second copy of the strategy for backtesting,
  you are testing the copy.
- Historical bars in NDJSON: one object per line,
  `{ ts, open, high, low, close, volume }`, ascending by `ts`, no gaps you have
  not accounted for.
- No network access required once data is on disk.

## Reference facts (verified)

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>. Fee
  schedules and any spread markup are venue policy and change; read the current
  figure from the docs or your own executed fills, and record whatever number
  you used in the report.
- The venue is 24/7. There are no session gaps, no overnight halts, and no
  auction opens. A backtest that assumes a daily reset is modeling a market that
  does not exist here.
- On-chain execution on Robinhood Chain costs gas in ETH at roughly 0.055 gwei
  observed. Small in dollar terms per transaction, not zero, and it applies to
  every failed transaction too.

## The three biases, and how this harness handles each

**Lookahead bias.** Using information the strategy could not have had at
decision time. The classic form is computing an indicator over a bar that had
not closed yet, or sizing an order using the bar's `close` when the decision was
made at the bar's `open`. Structural fix: the replayer hands the strategy a
frozen, immutable slice of history ending at bar `i - 1` and fills the resulting
order at bar `i`. The future is not reachable from inside `decide()` because it
is not in the object.

**Survivorship bias.** Backtesting only on assets that still trade today. Every
token that went to zero, got delisted, or lost its liquidity is missing from
your universe, so your strategy looks better than it was. This matters far more
in crypto than in equities. Fix: source your symbol universe from a snapshot of
what was listed *at the start of the test window*, keep delisted symbols in the
dataset with their final prices, and record the universe source in the report.
If you cannot source a point-in-time universe, say so in the report output
rather than quietly running on today's survivors.

**Cost bias.** Ignoring fees, spread, and slippage. On a 24/7 venue where a loop
can trade hundreds of times a day, costs dominate. A strategy with a 4 bps edge
per trade and 10 bps of round-trip cost is a machine for converting capital into
fees, and a zero-cost backtest will show it as profitable. **A backtest that
does not model fees on this venue is worthless.** The harness below refuses to
run with a zero cost model unless you explicitly pass
`acknowledgeZeroCost: true`, which also stamps the report as unrealistic.

## Steps

1. Create `src/backtest/costs.mjs` with a cost model: taker fee in bps, half
   spread paid on market orders, slippage as a function of order size relative
   to bar volume, and a fixed per-transaction gas cost for chain execution.
2. Create `src/backtest/replay.mjs`. Load bars, and for each index `i` build a
   read-only view of bars `0..i-1`. Call the strategy. Fill any resulting order
   at bar `i`'s open, adjusted by the cost model. Never at bar `i`'s close.
3. Model fills conservatively. A limit buy fills only if bar `i`'s low reached
   the limit price, and it fills at the limit price, not better. Assuming you
   caught the exact low of every bar is the second most common way a backtest
   lies.
4. Track equity per bar, realized and unrealized PnL, fees paid, and turnover.
5. Emit metrics: total return, max drawdown, Sharpe computed on the bar
   frequency and annualized with 365 days rather than 252, hit rate, average
   win/loss, and total cost as a percentage of gross PnL. That last one is the
   number that kills most strategies.
6. Print an assumptions block with every report. A number without its
   assumptions is not a result.
7. Add a lookahead canary test: a deliberately cheating strategy that reads
   `bars.at(-1).close` when it should not be able to. The test asserts the
   harness makes that value unavailable.

```js
/**
 * robinhood-toolkit · backtest replayer with explicit cost modeling
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function createCostModel({
  takerFeeBps = 30,
  halfSpreadBps = 5,
  slippageBpsPerVolShare = 50,
  gasCostQuote = 0,
} = {}) {
  if (takerFeeBps === 0 && halfSpreadBps === 0) {
    // caller must opt in via acknowledgeZeroCost in runBacktest
  }
  return {
    params: { takerFeeBps, halfSpreadBps, slippageBpsPerVolShare, gasCostQuote },
    /** Effective fill price including spread and size-dependent slippage. */
    fillPrice({ side, referencePrice, quantity, barVolume }) {
      const volShare = barVolume > 0 ? Math.min(1, quantity / barVolume) : 1;
      const bps = halfSpreadBps + slippageBpsPerVolShare * volShare;
      const adj = referencePrice * (bps / 10_000);
      return side === 'buy' ? referencePrice + adj : referencePrice - adj;
    },
    fee({ price, quantity }) {
      return price * quantity * (takerFeeBps / 10_000) + gasCostQuote;
    },
  };
}

export async function runBacktest({
  bars,
  strategy,
  costs,
  startingCash = 10_000,
  acknowledgeZeroCost = false,
}) {
  const { takerFeeBps, halfSpreadBps } = costs.params;
  if (takerFeeBps === 0 && halfSpreadBps === 0 && !acknowledgeZeroCost) {
    throw new Error(
      'zero-cost backtest refused: set real fees, or pass acknowledgeZeroCost:true to mark the run unrealistic',
    );
  }

  let cash = startingCash;
  let position = 0;
  let feesPaid = 0;
  let trades = 0;
  const equityCurve = [];

  for (let i = 1; i < bars.length; i += 1) {
    // The strategy sees only bars strictly before i. Frozen so it cannot be mutated.
    const history = Object.freeze(bars.slice(0, i).map(Object.freeze));
    const bar = bars[i];

    const signal = await strategy.decide({
      symbol: strategy.symbol ?? 'BACKTEST',
      bars: { closed: () => history, lastClosed: () => history.at(-1) },
      quote: { bid: history.at(-1).close, ask: history.at(-1).close, ts: history.at(-1).start },
      now: bar.ts ?? bar.start,
    });

    if (signal) {
      const reference = bar.open; // decision at i-1 close, fill at i open
      const crossable =
        signal.type !== 'limit' ||
        (signal.side === 'buy' ? bar.low <= signal.limitPrice : bar.high >= signal.limitPrice);

      if (crossable) {
        const price = costs.fillPrice({
          side: signal.side,
          referencePrice: signal.type === 'limit' ? signal.limitPrice : reference,
          quantity: signal.quantity,
          barVolume: bar.volume ?? 0,
        });
        const fee = costs.fee({ price, quantity: signal.quantity });
        const delta = signal.side === 'buy' ? signal.quantity : -signal.quantity;
        cash -= delta * price + fee;
        position += delta;
        feesPaid += fee;
        trades += 1;
      }
    }

    equityCurve.push({ ts: bar.ts ?? bar.start, equity: cash + position * bar.close });
  }

  return summarize({ equityCurve, startingCash, feesPaid, trades, costs, bars });
}

function summarize({ equityCurve, startingCash, feesPaid, trades, costs, bars }) {
  const final = equityCurve.at(-1)?.equity ?? startingCash;
  const returns = equityCurve.slice(1).map((p, i) => p.equity / equityCurve[i].equity - 1);
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const sd = Math.sqrt(returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length || 1));

  const barMs = (bars[1]?.ts ?? bars[1]?.start) - (bars[0]?.ts ?? bars[0]?.start);
  const barsPerYear = barMs > 0 ? (365 * 24 * 60 * 60 * 1000) / barMs : 0;

  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - p.equity) / peak);
  }

  const grossPnl = final - startingCash + feesPaid;

  return {
    startingCash,
    finalEquity: Number(final.toFixed(2)),
    totalReturnPct: Number(((final / startingCash - 1) * 100).toFixed(3)),
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(3)),
    sharpe: sd > 0 ? Number(((mean / sd) * Math.sqrt(barsPerYear)).toFixed(3)) : null,
    trades,
    feesPaid: Number(feesPaid.toFixed(2)),
    costAsPctOfGrossPnl: grossPnl !== 0 ? Number(((feesPaid / Math.abs(grossPnl)) * 100).toFixed(1)) : null,
    assumptions: {
      fillTiming: 'decision at bar i-1 close, fill at bar i open',
      limitFillRule: 'fills only if the bar traded through the limit, at the limit price',
      costModel: costs.params,
      annualization: '365 days, 24/7 venue, no session gaps',
      survivorship: 'UNVERIFIED unless a point-in-time symbol universe was supplied',
      note: 'past bar data does not include the order book. Real slippage on size may exceed the model.',
    },
  };
}
```

## Deliverable

- `src/backtest/costs.mjs` and `src/backtest/replay.mjs`.
- `scripts/backtest.mjs` CLI reading NDJSON bars and printing the report plus
  the assumptions block.
- `test/backtest.test.js` including the lookahead canary described in step 7.

## How to verify

```sh
cd packages/agent
node --test test/backtest.test.js
node scripts/backtest.mjs --bars data/btc-1m.ndjson --strategy momentum
node scripts/backtest.mjs --bars data/btc-1m.ndjson --strategy momentum --taker-fee-bps 0
# the last command must exit non-zero with the zero-cost refusal
```

Sanity check the result against a buy-and-hold baseline over the same bars. A
strategy that underperforms holding, after costs, is not a strategy.

## Gotchas

- **A backtest is a hypothesis, not evidence.** The only thing it proves is that
  the strategy would not have obviously failed on one specific past. Treat a
  good result as permission to run paper mode (prompt 04), never as permission
  to go live.
- Overfitting is silent. If you tuned `fast` and `slow` by rerunning until the
  number went up, you fit the noise. Hold out a time period you never looked at
  and run it once at the end.
- Bar data hides the order book. A 1-minute bar showing a low of 100 does not
  mean you could have bought a meaningful size at 100.
- Gaps in NDJSON data silently compress time. Assert that consecutive bar
  timestamps differ by exactly one bucket, and report gaps rather than skipping
  them.
- Do not annualize with 252 trading days. This venue has 365.
- Fees change. A report from six months ago with a stale fee assumption is not
  comparable to today's run. That is why the assumptions block is part of the
  output rather than a comment in the code.
<!-- built by nirholas x.com/nichxbt -->
