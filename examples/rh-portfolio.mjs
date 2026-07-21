/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · print a portfolio snapshot
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';
import { getFeeTier, markToMarket } from '../packages/rh-crypto/portfolio.mjs';

const rh = new RobinhoodCrypto();
const snapshot = await markToMarket(rh);

console.log(`account ${snapshot.account_number} (${snapshot.status})`);
console.log(`cash ${snapshot.cash.toFixed(2)} ${snapshot.currency}`);
for (const p of snapshot.positions) {
  const value = p.value === null ? 'unpriced' : p.value.toFixed(2);
  const locked = p.locked > 0 ? ` (${p.locked} locked)` : '';
  console.log(`  ${p.asset_code.padEnd(6)} ${String(p.total_quantity).padEnd(16)} ${value}${locked}`);
}
console.log(`total ${snapshot.total.toFixed(2)} ${snapshot.currency}`);
if (snapshot.unpriced.length) console.log(`unpriced: ${snapshot.unpriced.join(', ')}`);

const tier = await getFeeTier(rh);
if (tier) {
  console.log(`fee ratio ${tier.fee_ratio} on 30d volume ${tier.thirty_day_volume}`);
  if (tier.next_fee_tier_threshold !== null) {
    const gap = Number(tier.next_fee_tier_threshold) - Number(tier.thirty_day_volume);
    console.log(`next tier ${tier.next_fee_tier_ratio} at ${tier.next_fee_tier_threshold} (${gap.toFixed(2)} to go)`);
  } else {
    console.log('already in the top available fee tier');
  }
}
/* built by nirholas x.com/nichxbt */
