/* built by nirholas x.com/nichxbt */
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
/* built by nirholas x.com/nichxbt */
