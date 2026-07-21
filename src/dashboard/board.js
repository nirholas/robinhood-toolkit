/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · dashboard configuration
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Pools are identified by ADDRESS (v3) or POOL ID (v4). Never by symbol:
 * symbols collide, including on the same chain. See prompt 01.
 */

export const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

export const BOARD = [
  { pairAddress: '0xA70fc67C9F69da90B63a0e4C05D229954574E313', label: 'CASHCAT/WETH' },
  { pairAddress: '0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA', label: 'PONS/WETH' },
  { pairAddress: '0x3b054359e248009e797afbcfa975fa4cf5147d503421af53f179be1abf63d46f', label: 'SQUEEZE/WETH' },
  { pairAddress: '0x237609918F330ADD285b8bC5f8f2922283D1C4C5', label: 'TENDIES/WETH' },
  { pairAddress: '0x9501A20Bedb8beA0798FE5D4c411f5e270965D49', label: 'WALLET/WETH' },
  { pairAddress: '0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca', label: 'USDG/WETH' },
];

/** A v4 pool ID is 32 bytes (66 chars with 0x). A v3 pool is a 20-byte address. */
export function isV4Pool(pairAddress) {
  return typeof pairAddress === 'string' && pairAddress.length === 66;
}

/** On-chain candle aggregation only works for v3 pools. */
export function supportsOnchainCandles(pair) {
  if (isV4Pool(pair.pairAddress)) return false;
  return !pair.labels || pair.labels.includes('v3');
}

/** Decimal places that keep a price legible across six orders of magnitude. */
export function precisionFor(price) {
  const p = Math.abs(Number(price));
  if (!Number.isFinite(p) || p === 0) return 6;
  if (p >= 1000) return 2;
  if (p >= 1) return 4;
  if (p >= 0.01) return 5;
  if (p >= 0.0001) return 6;
  return Math.min(12, Math.ceil(-Math.log10(p)) + 4);
}

export function formatPrice(price) {
  if (price === null || price === undefined || !Number.isFinite(Number(price))) return '--';
  return Number(price).toFixed(precisionFor(price));
}

export function formatUsd(n) {
  if (!Number.isFinite(Number(n))) return '--';
  const v = Number(n);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

export function formatPct(n) {
  if (!Number.isFinite(Number(n))) return '--';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
/* built by nirholas x.com/nichxbt */
