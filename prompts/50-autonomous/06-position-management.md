<!--
  robinhood-toolkit · build prompt: position tracking, reconciliation, and exits
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 06 · Position management

## Goal

Maintain an authoritative view of what the agent actually holds, reconcile it
against the venue and the chain on every cycle, size new orders from that view,
and enforce exits (stop loss, take profit, max holding time) independently of
the strategy that opened the position.

## Prerequisites

- Prompts 01, 04, and 05 completed.
- `npm i viem` for on-chain balance reads.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |

- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` · USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- The venue is the authority on venue positions; the chain is the authority on
  chain positions. Your in-memory book is a cache and should be treated as
  suspect on every restart.
- 24/7 trading means "maximum holding period" is a real risk control, not a
  formality. A position opened Friday evening on a thesis that expired by
  Saturday morning has nobody watching it unless you built the watcher.

## Steps

1. Create `src/positions.mjs` with a `PositionBook`: per-symbol quantity, volume
   weighted average entry price, realized PnL, unrealized PnL against a mark,
   opened-at timestamp, and the `clientOrderId` list that built it.
2. Compute average entry with a proper VWAP that handles adds, partial closes,
   and reversals. On a partial close, realize PnL on the closed portion and
   leave the average entry of the remainder unchanged. Recomputing the average
   on a close is a common bug that silently corrupts every PnL number
   downstream.
3. Implement `reconcile(local, remote)`. Compare quantity per symbol against the
   broker's `getPositions()` with a tolerance for dust. On mismatch: log a
   critical event, adopt the remote as truth, and trip the kill switch if the
   drift exceeds `maxDriftPct`. Drift means either your fill handling is wrong
   or somebody else is trading this account, and both warrant stopping.
4. Reconcile on boot before the first tick, then on a fixed interval. Never
   place an order from an unreconciled book after a restart.
5. Create `src/exits.mjs` as a supervisor that runs every tick regardless of
   whether the strategy produced a signal. It enforces stop loss, take profit,
   trailing stop, and max holding duration. Exits must not be the strategy's
   responsibility: a strategy with a bug stops emitting signals, and a position
   with no independent exit then sits open forever.
6. Size orders from the book, not from a constant. Cap per-symbol exposure as a
   fraction of equity, and cap total exposure across symbols. Correlated
   positions in crypto are effectively one position; five altcoin longs are a
   leveraged beta bet, not diversification.
7. Route every exit order through the same policy engine and broker as an entry.
   An exit path that bypasses guardrails is a guardrail bypass.

```js
/**
 * robinhood-toolkit · position book with VWAP entry and reconciliation
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function createPositionBook() {
  const book = new Map();

  function get(symbol) {
    if (!book.has(symbol)) {
      book.set(symbol, {
        symbol, quantity: 0, avgEntry: 0, realizedPnl: 0, fees: 0,
        openedAt: null, highWaterMark: null, orderIds: [],
      });
    }
    return book.get(symbol);
  }

  return {
    get,
    all: () => [...book.values()].filter((p) => p.quantity !== 0),

    applyFill({ symbol, side, filledQuantity, filledPrice, fee = 0, clientOrderId, ts }) {
      const p = get(symbol);
      const signed = side === 'buy' ? filledQuantity : -filledQuantity;
      const opening = p.quantity === 0 || Math.sign(p.quantity) === Math.sign(signed);

      if (opening) {
        const newQty = p.quantity + signed;
        // VWAP over absolute size. Average entry only moves when adding.
        p.avgEntry = (p.avgEntry * Math.abs(p.quantity) + filledPrice * filledQuantity) / Math.abs(newQty);
        p.quantity = newQty;
        p.openedAt ??= ts ?? new Date().toISOString();
      } else {
        const closing = Math.min(Math.abs(signed), Math.abs(p.quantity));
        const direction = p.quantity > 0 ? 1 : -1;
        p.realizedPnl += (filledPrice - p.avgEntry) * closing * direction;
        p.quantity += signed;
        // Average entry of the remainder is unchanged. Do not recompute it here.
        if (Math.abs(p.quantity) < 1e-12) {
          p.quantity = 0;
          p.avgEntry = 0;
          p.openedAt = null;
          p.highWaterMark = null;
        } else if (Math.sign(p.quantity) !== direction) {
          p.avgEntry = filledPrice; // flipped through zero, new position
          p.openedAt = ts ?? new Date().toISOString();
        }
      }

      p.fees += fee;
      p.orderIds.push(clientOrderId);
      return p;
    },

    unrealized(symbol, mark) {
      const p = get(symbol);
      return p.quantity === 0 ? 0 : (mark - p.avgEntry) * p.quantity;
    },

    equity(marks, cash) {
      return [...book.values()].reduce((a, p) => a + p.quantity * (marks[p.symbol] ?? p.avgEntry), cash);
    },
  };
}

export function reconcile({ local, remote, dustTolerance = 1e-8, maxDriftPct = 1 }) {
  const symbols = new Set([...Object.keys(remote), ...local.all().map((p) => p.symbol)]);
  const diffs = [];

  for (const symbol of symbols) {
    const localQty = local.get(symbol).quantity;
    const remoteQty = Number(remote[symbol] ?? 0);
    const delta = remoteQty - localQty;
    if (Math.abs(delta) <= dustTolerance) continue;

    const driftPct = remoteQty !== 0 ? Math.abs(delta / remoteQty) * 100 : Infinity;
    diffs.push({ symbol, localQty, remoteQty, delta, driftPct });
  }

  const critical = diffs.some((d) => d.driftPct > maxDriftPct);
  return {
    ok: diffs.length === 0,
    critical,
    diffs,
    action: critical ? 'halt_and_adopt_remote' : diffs.length ? 'adopt_remote' : 'none',
  };
}
```

```js
/**
 * robinhood-toolkit · independent exit supervisor
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function createExitSupervisor({
  stopLossPct = 2,
  takeProfitPct = 4,
  trailingStopPct = null,
  maxHoldMs = 24 * 60 * 60 * 1000,
} = {}) {
  return {
    /** Returns exit intents for every position that breached a rule. */
    check({ book, marks, now = Date.now() }) {
      const exits = [];

      for (const p of book.all()) {
        const mark = marks[p.symbol];
        if (mark === undefined) continue;

        const direction = p.quantity > 0 ? 1 : -1;
        const pnlPct = ((mark - p.avgEntry) / p.avgEntry) * 100 * direction;

        if (trailingStopPct !== null) {
          p.highWaterMark = p.highWaterMark === null ? mark : (direction > 0 ? Math.max : Math.min)(p.highWaterMark, mark);
        }

        let reason = null;
        if (pnlPct <= -stopLossPct) reason = `stop_loss ${pnlPct.toFixed(2)}% <= -${stopLossPct}%`;
        else if (pnlPct >= takeProfitPct) reason = `take_profit ${pnlPct.toFixed(2)}% >= ${takeProfitPct}%`;
        else if (trailingStopPct !== null && p.highWaterMark !== null) {
          const giveback = ((p.highWaterMark - mark) / p.highWaterMark) * 100 * direction;
          if (giveback >= trailingStopPct) reason = `trailing_stop gave back ${giveback.toFixed(2)}%`;
        }
        if (!reason && p.openedAt && now - Date.parse(p.openedAt) > maxHoldMs) {
          reason = `max_hold exceeded ${Math.round(maxHoldMs / 3600000)}h`;
        }
        if (!reason) continue;

        exits.push({
          clientOrderId: `exit-${p.symbol}-${now}`,
          symbol: p.symbol,
          side: p.quantity > 0 ? 'sell' : 'buy',
          type: 'market',
          quantity: Math.abs(p.quantity),
          reason,
          isExit: true,
        });
      }

      return exits;
    },
  };
}
```

## Deliverable

- `src/positions.mjs` with `createPositionBook` and `reconcile`.
- `src/exits.mjs` with the exit supervisor, called from the loop before the
  strategy on every tick.
- `src/sizing.mjs` computing order size from equity, per-symbol cap, and total
  exposure cap.
- `test/positions.test.js` covering add, partial close, full close, and reversal
  through zero.

## How to verify

```sh
cd packages/agent
node --test test/positions.test.js
node scripts/reconcile.mjs        # prints diff table against the live broker
```

Manually create a drift: place a small order outside the agent, then run
`reconcile.mjs`. It must report the diff, adopt the remote figure, and trip the
kill switch when drift exceeds the threshold.

## Gotchas

- Exits run before the strategy on every tick. If the strategy runs first and
  opens a position, the exit supervisor should not evaluate it in the same tick
  with a stale mark.
- A partial close that recomputes average entry destroys realized PnL accuracy
  for the rest of the position's life, and the error compounds silently. The
  test for reversal through zero is the one that catches it.
- Floating point quantities accumulate error. Compare against a dust tolerance,
  never with `===`. For chain assets, prefer integer base units (`bigint`) and
  convert only for display.
- Reconciliation that silently adopts remote hides a real bug. Always log the
  diff at critical level, even when the drift is under the halt threshold.
- Max holding period is the control that saves you on a quiet weekend when a
  thesis has expired and nothing else is watching. Do not set it to `Infinity`
  because it felt arbitrary.
- Correlated positions are one position. Cap total crypto exposure, not just
  per-symbol exposure.
