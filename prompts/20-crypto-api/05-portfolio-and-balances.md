<!--
  robinhood-toolkit · build prompt: portfolio, holdings, and fee tiers
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 05 · Portfolio and balances

## Goal

Build a portfolio module that reports buying power, per-asset holdings, mark-to-
market value, and your current fee tier. This is also where you decide, once and
deliberately, whether your bot trades v1 or v2.

## Prerequisites

- Prompts 01 and 02 complete.

## Reference facts

| Endpoint | Method | Notes |
|---|---|---|
| `/api/v1/crypto/trading/accounts/` | GET | Single account object, no pagination |
| `/api/v1/crypto/trading/holdings/` | GET | `asset_code` (repeatable), `limit`, `cursor` |
| `/api/v2/crypto/trading/accounts/` | GET | Paginated list, `cursor`, `limit` |
| `/api/v2/crypto/trading/holdings/` | GET | **`account_number` required**, plus `asset_code`, `cursor`, `limit` |

### Schemas

`Account` (v1): `account_number`, `status` (`active` | `deactivated` |
`sell_only`), `buying_power`, `buying_power_currency`.

`V2Account`: the same four fields plus `account_type`, `is_api_tradable`, and
`fee_tier_status`.

`FeeTierStatus`: `fee_ratio`, `thirty_day_volume`, `next_fee_tier_ratio`
(nullable), `next_fee_tier_threshold` (nullable). Nulls mean you are already in
the best tier available to you.

`Holdings` (v1): `account_number`, `asset_code`, `total_quantity`,
`quantity_available_for_trading` (numbers).

`V2Holding`: the same fields, but `total_quantity` and
`quantity_available_for_trading` are **strings**. This is a real type change
between versions, not a documentation slip.

### v1 versus v2

Per Robinhood's Help Center: v2 is the fee-tier endpoint set, v1 is the
non-fee-tier set. All read-only actions exist on both. Only orders placed
through the **v2** endpoint count toward your eligible 30-day trading volume for
fee-tier purposes. Fee-tier trading is limited to eligible jurisdictions. There
is currently no announced deprecation date for v1.

Practical read: if you care about fee tiers or intend to build volume, place
orders on v2. If you want the simplest surface and volume is irrelevant, v1 is
fewer moving parts. Do not mix order placement across both versions, because
half your volume then stops counting.

## Steps

1. Write `packages/rh-crypto/portfolio.mjs`:

```js
/**
 * robinhood-toolkit · portfolio and balance reads
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { bestBidAsk } from './marketdata.mjs';

export async function getAccount(rh) {
  return rh.get('/api/v1/crypto/trading/accounts/');
}

/** v2 accounts are a paginated list; returns the array. */
export async function getAccountsV2(rh) {
  const page = await rh.get('/api/v2/crypto/trading/accounts/', { limit: 100 });
  return page.results ?? [];
}

/** Fee tier for an account, or null if the account carries no tier status. */
export async function getFeeTier(rh, accountNumber) {
  const accounts = await getAccountsV2(rh);
  const account = accountNumber
    ? accounts.find((a) => a.account_number === accountNumber)
    : accounts[0];
  return account?.fee_tier_status ?? null;
}

/** All holdings, following pagination. Quantities normalized to numbers. */
export async function getHoldings(rh, { assetCodes } = {}) {
  const out = [];
  let page = await rh.get('/api/v1/crypto/trading/holdings/', {
    asset_code: assetCodes,
    limit: 100,
  });
  for (;;) {
    for (const h of page.results ?? []) {
      out.push({
        account_number: h.account_number,
        asset_code: h.asset_code,
        total_quantity: Number(h.total_quantity),
        quantity_available_for_trading: Number(h.quantity_available_for_trading),
      });
    }
    if (!page.next) break;
    const url = new URL(page.next);
    page = await rh.get(url.pathname, Object.fromEntries(url.searchParams));
  }
  return out;
}

/**
 * Mark holdings to market against the current bid, since selling is what you
 * would actually receive. Skips assets with no USD pair.
 */
export async function markToMarket(rh, { quote = 'USD' } = {}) {
  const holdings = (await getHoldings(rh)).filter((h) => h.total_quantity > 0);
  const symbols = holdings.map((h) => `${h.asset_code}-${quote}`);
  const book = symbols.length ? await bestBidAsk(rh, symbols) : new Map();

  const positions = holdings.map((h) => {
    const top = book.get(`${h.asset_code}-${quote}`);
    const price = top ? Number(top.bid_inclusive_of_sell_spread) : null;
    return {
      ...h,
      symbol: `${h.asset_code}-${quote}`,
      price,
      value: price === null ? null : price * h.total_quantity,
      locked: h.total_quantity - h.quantity_available_for_trading,
    };
  });

  const account = await getAccount(rh);
  const invested = positions.reduce((sum, p) => sum + (p.value ?? 0), 0);
  const cash = Number(account.buying_power);

  return {
    account_number: account.account_number,
    status: account.status,
    currency: account.buying_power_currency,
    cash,
    invested,
    total: cash + invested,
    unpriced: positions.filter((p) => p.value === null).map((p) => p.asset_code),
    positions: positions.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
  };
}

/** Fraction of the portfolio held in one asset, 0 to 1. */
export function concentration(snapshot, assetCode) {
  if (!(snapshot.total > 0)) return 0;
  const position = snapshot.positions.find((p) => p.asset_code === assetCode);
  return (position?.value ?? 0) / snapshot.total;
}
```

2. Write `examples/rh-portfolio.mjs`:

```js
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
```

3. Decide v1 or v2 for order placement and write the decision into
   `packages/rh-crypto/README.md` with the reason. Every later prompt should read
   one constant rather than rediscovering the choice.

## Deliverable

- `packages/rh-crypto/portfolio.mjs` exporting `getAccount`, `getAccountsV2`,
  `getFeeTier`, `getHoldings`, `markToMarket`, `concentration`
- `examples/rh-portfolio.mjs`
- A documented v1/v2 decision in the package README

## How to verify

```sh
node --env-file=.env examples/rh-portfolio.mjs
```

Compare `cash` against buying power in the Robinhood app and each position's
quantity against the app's holdings. They must match exactly. `total` should be
within a fraction of a percent of the app's crypto value; small differences are
expected because you are marking against the bid inclusive of spread while the
app may display a mid.

If `getFeeTier` returns null, your account is not enrolled in fee tiers, which
means placing orders on v2 will not benefit you. Record that in the README.

## Gotchas

- **v2 holdings quantities are strings, v1 are numbers.** Arithmetic on the v2
  shape without coercion silently concatenates. The module above normalizes at
  the boundary so nothing downstream has to care.
- **`quantity_available_for_trading` is the number that matters.** `total_quantity`
  includes quantity locked by resting sell orders. Sizing a sell off
  `total_quantity` produces rejections that look like phantom balance bugs.
- **`GET /api/v2/crypto/trading/holdings/` requires `account_number`.** The v1
  equivalent does not. Omitting it on v2 is a 400, not an empty list.
- **v1 accounts is a single object; v2 accounts is a paginated list.** Do not
  reach for `.results` on the v1 response or index `[0]` on the v2 one without
  the array.
- **Only v2 orders count toward 30-day volume.** If you place through v1,
  `thirty_day_volume` stays flat no matter how much you trade, and it will look
  like a reporting bug. It is not.
- **`status` has three values.** `sell_only` accounts accept sells and reject
  buys. Check it at startup and fail loudly rather than discovering it on your
  first buy.
- **Not every held asset has a USD pair you can price.** `markToMarket` reports
  those in `unpriced` rather than silently valuing them at zero, which would make
  your portfolio total quietly wrong.
- Fee tier is per account and can change as volume rolls off a 30-day window.
  Re-read it rather than caching it for the life of the process.
