/**
 * robinhood-toolkit · momentum (EMA crossover) strategy
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Implements the Strategy seam from src/ports.mjs. Emits a Signal only on a
 * state transition (flat <-> long), never on every tick the condition holds —
 * the loop's cooldown is a backstop, not the primary de-duplication.
 *
 * This is the exact module the backtester (prompt 03) imports. There is no
 * second copy: the replayer feeds it a frozen slice of history and it cannot
 * tell that it is being replayed, which is the whole point.
 */
import { ema } from '../market/indicators.mjs';

export default function createMomentumStrategy({
  fast = 12,
  slow = 26,
  quantity = 0.001,
  maxQuoteAgeMs = 90_000,
} = {}) {
  const lastState = new Map();

  return {
    name: 'ema-crossover',
    params: { fast, slow, quantity, maxQuoteAgeMs },

    decide({ symbol, quote, bars, now = Date.now() }) {
      const closedBars = bars?.closed?.() ?? [];
      if (closedBars.length < slow) return null; // insufficient history, not a hold

      const last = closedBars.at(-1);
      // Staleness gate. `duration` is the bucket length; if the newest closed
      // bar ended more than maxQuoteAgeMs ago the feed (or the data) has a gap
      // and we refuse to act on it. Skipped cleanly when duration is unknown.
      if (Number.isFinite(last?.start) && Number.isFinite(last?.duration)) {
        if (now - (last.start + last.duration) > maxQuoteAgeMs) return null;
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
        confidence: Math.min(1, (Math.abs(f - s) / s) * 100),
        reason: `ema${fast}=${f.toFixed(2)} crossed ${state === 'long' ? 'above' : 'below'} ema${slow}=${s.toFixed(2)}`,
        inputs: { fast: f, slow: s, bars: closedBars.length, spread, quoteTs: quote.ts },
        generatedAt: new Date(now).toISOString(),
      };
    },
  };
}
