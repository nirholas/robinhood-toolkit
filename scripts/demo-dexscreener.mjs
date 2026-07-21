/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · DexScreener client smoke test
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getPair, getPoolsForToken, getTokens, search, deepestPool, ROBINHOOD }
  from '../src/dexscreener.js';

const USDG_REAL = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'; // Global Dollar
const USDG_FAKE = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'; // ticker squatter
const WETH      = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

const pair = await getPair('0x95f9B0AF9282A22F7ef57058e65098db3f667f95');
console.log('pair:', pair.base.symbol, '/', pair.quote.symbol,
            '$' + pair.priceUsd, 'liq $' + pair.liquidityUsd);

const pools = await getPoolsForToken(USDG_REAL);
const best = deepestPool(pools);
console.log(`pools for real USDG: ${pools.length}, deepest ${best.pairAddress} ` +
            `($${best.liquidityUsd.toLocaleString()})`);

const batch = await getTokens([USDG_REAL, USDG_FAKE, WETH]);
for (const [addr, list] of batch) {
  const top = deepestPool(list);
  console.log(addr, '->', top ? `${top.base.name} @ $${top.priceUsd}` : 'no pools');
}

const hits = await search('USDG', { chainId: ROBINHOOD });
const distinct = new Map(hits.map((p) => [p.base.address, p.base.name]));
console.log('distinct tokens on Robinhood Chain ticking USDG:', distinct.size);
for (const [addr, name] of distinct) console.log('  ', addr, name);
