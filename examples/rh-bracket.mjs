/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · resting limit buy that arms a stop-loss on fill
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Places a limit buy roughly 20% below market, tracks it to a terminal state,
 * and — once it fills — arms a stop-loss sell for the exact filled quantity at a
 * stop roughly 10% below the average fill. Dry run is the default; a real order
 * requires --live, matching examples/rh-first-order.mjs.
 *
 * Usage:
 *   node --env-file=.env examples/rh-bracket.mjs BTC-USD              # dry run
 *   node --env-file=.env examples/rh-bracket.mjs BTC-USD --live       # spends money
 *   node --env-file=.env examples/rh-bracket.mjs BTC-USD --live --entry 0.15 --stop 0.08
 *
 * --entry is the fraction below market for the limit buy (default 0.20).
 * --stop  is the fraction below the fill for the stop trigger (default 0.10).
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';
import { bestBidAsk, listTradingPairs } from '../packages/rh-crypto/marketdata.mjs';
import {
  assertStopSane,
  assertTradable,
  buildOrder,
  limitConfig,
  placeOrder,
  roundToIncrement,
  stopLossConfig,
} from '../packages/rh-crypto/orders.mjs';
import { averageFill, track } from '../packages/rh-crypto/lifecycle.mjs';

function flagValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

const symbol = process.argv[2] ?? 'BTC-USD';
const live = process.argv.includes('--live');
const entryFraction = flagValue('--entry', 0.2); // limit buy this far below market
const stopFraction = flagValue('--stop', 0.1); // stop trigger this far below the fill

const rh = new RobinhoodCrypto();

const [pair] = await listTradingPairs(rh, { symbols: [symbol] });
if (!pair) throw new Error(`no such trading pair: ${symbol}`);

// A resting buy far below market is unlikely to fill soon, so the minimum size
// keeps the parked capital small.
const quantity = roundToIncrement(pair.min_order_size, pair.asset_increment);
assertTradable(pair, { side: 'buy', quantity });

// Mid price from top of book. `price` on the v1 BidAskPrice is the mid.
const top = (await bestBidAsk(rh, symbol)).get(symbol);
if (!top) throw new Error(`no market data for ${symbol}`);
const mid = Number(top.price);
const limitPrice = roundToIncrement(String(mid * (1 - entryFraction)), pair.quote_increment);

console.log(
  `${symbol}: mid=${mid} placing limit buy ${quantity} ${pair.asset_code} @ ${limitPrice} ` +
    `(${(entryFraction * 100).toFixed(0)}% below market)`,
);

const buy = buildOrder({
  symbol,
  side: 'buy',
  type: 'limit',
  config: limitConfig({ assetQuantity: quantity, limitPrice }),
});

const placed = await placeOrder(rh, buy, { dryRun: !live });
console.log(placed);

if (!live) {
  // Show the stop-loss that a fill would arm, so the dry run is fully inspectable.
  const wouldStop = roundToIncrement(String(mid * (1 - stopFraction)), pair.quote_increment);
  const stopConfig = stopLossConfig({ assetQuantity: quantity, stopPrice: wouldStop, timeInForce: 'gtc' });
  const stopBody = buildOrder({ symbol, side: 'sell', type: 'stop_loss', config: stopConfig });
  console.log('on fill, would arm:', await placeOrder(rh, stopBody, { dryRun: true }));
  console.log('\ndry run — pass --live to place real orders');
  process.exit(0);
}

// Track the resting buy. It may sit open for a long time; the tracker returns
// once terminal or the timeout elapses, and stop-loss arming only happens on a
// genuine fill.
console.log('tracking buy order...');
const finalBuy = await track(rh, placed.id, {
  intervalMs: 2_000,
  timeoutMs: 300_000,
  onChange: (order) =>
    console.log(`  state=${order.state} filled=${order.filled_asset_quantity ?? 0}`),
});

const filledQty = Number(finalBuy.filled_asset_quantity ?? 0);
if (!(filledQty > 0)) {
  console.log(`buy ended ${finalBuy.state} with no fill; nothing to protect`);
  process.exit(0);
}

// Base the stop on what actually filled, not what we requested.
const fillPrice = averageFill(finalBuy) ?? mid;
const stopQuantity = roundToIncrement(String(filledQty), pair.asset_increment);
const stopPrice = roundToIncrement(String(fillPrice * (1 - stopFraction)), pair.quote_increment);

// Refuse a stop that would trigger immediately against the current market.
assertStopSane({ side: 'sell', stopPrice, lastPrice: mid });

const stop = buildOrder({
  symbol,
  side: 'sell',
  type: 'stop_loss',
  config: stopLossConfig({ assetQuantity: stopQuantity, stopPrice, timeInForce: 'gtc' }),
});

console.log(`filled ${stopQuantity} @ ~${fillPrice}; arming stop-loss sell @ ${stopPrice}`);
const stopResult = await placeOrder(rh, stop, { dryRun: false });
console.log(stopResult);
/* built by nirholas x.com/nichxbt */
