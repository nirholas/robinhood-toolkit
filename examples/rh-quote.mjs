/**
 * robinhood-toolkit · print a size-aware quote for a symbol
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';
import { bestBidAsk, estimatedPrice, listTradingPairs, slippageBps } from '../packages/rh-crypto/marketdata.mjs';

const symbol = process.argv[2] ?? 'BTC-USD';
const rh = new RobinhoodCrypto();

const [pair] = await listTradingPairs(rh, { symbols: [symbol] });
if (!pair) throw new Error(`no such trading pair: ${symbol}`);
console.log(`${pair.symbol} status=${pair.status} min=${pair.min_order_size} max=${pair.max_order_size} step=${pair.asset_increment}`);

const top = (await bestBidAsk(rh, symbol)).get(symbol);
console.log(`top of book: bid=${top.bid_inclusive_of_sell_spread} ask=${top.ask_inclusive_of_buy_spread} mid=${top.price}`);

const size = Number(pair.min_order_size) * 10;
const quote = await estimatedPrice(rh, { symbol, side: 'ask', quantities: [size] });
const sized = quote.results[0];
console.log(`buying ${size}: price=${sized.price} slippage=${slippageBps({ topOfBook: top, sized, side: 'ask' }).toFixed(1)}bps`);
