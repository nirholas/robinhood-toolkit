/* built by nirholas x.com/nichxbt */
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
