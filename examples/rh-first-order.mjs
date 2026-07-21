/**
 * robinhood-toolkit · place one minimum-size market order
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Usage:
 *   node --env-file=.env examples/rh-first-order.mjs BTC-USD          # dry run
 *   node --env-file=.env examples/rh-first-order.mjs BTC-USD --live   # spends money
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';
import { estimatedPrice, listTradingPairs } from '../packages/rh-crypto/marketdata.mjs';
import { assertTradable, buildOrder, placeOrder, roundToIncrement, waitForTerminal } from '../packages/rh-crypto/orders.mjs';

const symbol = process.argv[2] ?? 'BTC-USD';
const live = process.argv.includes('--live');
const rh = new RobinhoodCrypto();

const [pair] = await listTradingPairs(rh, { symbols: [symbol] });
const quantity = roundToIncrement(pair.min_order_size, pair.asset_increment);
assertTradable(pair, { side: 'buy', quantity });

const quote = await estimatedPrice(rh, { symbol, side: 'ask', quantities: [quantity] });
const estimate = quote.results[0];
console.log(`buying ${quantity} ${pair.asset_code} at about ${estimate.price} (est cost ${(Number(estimate.price) * Number(quantity)).toFixed(2)} USD)`);

const body = buildOrder({
  symbol,
  side: 'buy',
  type: 'market',
  config: { asset_quantity: quantity },
});

const result = await placeOrder(rh, body, { dryRun: !live });
console.log(result);

if (live) {
  const final = await waitForTerminal(rh, result.id);
  console.log(`state=${final.state} filled=${final.filled_asset_quantity} avg=${final.average_price}`);
}
