/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · unit tests for order lifecycle helpers
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Pure functions only. Runs with no network, no key, no spend:
 *   node --test packages/rh-crypto/lifecycle.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { averageFill, fillRatio, isTerminal } from './lifecycle.mjs';

test('isTerminal recognizes exactly the three terminal states', () => {
  for (const state of ['filled', 'canceled', 'failed']) {
    assert.equal(isTerminal(state), true, `${state} is terminal`);
  }
  // Unknown / non-terminal states keep the caller polling.
  for (const state of ['open', 'partially_filled', 'pending', 'brand_new_state', undefined]) {
    assert.equal(isTerminal(state), false, `${state} is not terminal`);
  }
});

test('averageFill is null before the first fill', () => {
  assert.equal(averageFill({}), null);
  assert.equal(averageFill({ executions: [] }), null);
});

test('averageFill computes a quantity-weighted average from string decimals', () => {
  const order = {
    executions: [
      { effective_price: '100', quantity: '1', timestamp: 't1' },
      { effective_price: '200', quantity: '3', timestamp: 't2' },
    ],
  };
  // (100*1 + 200*3) / (1+3) = 700/4 = 175
  assert.equal(averageFill(order), 175);
});

test('averageFill guards a zero total quantity', () => {
  const order = { executions: [{ effective_price: '100', quantity: '0', timestamp: 't1' }] };
  assert.equal(averageFill(order), null);
});

test('fillRatio divides filled by the requested asset_quantity', () => {
  const order = {
    market_order_config: { asset_quantity: '0.5' },
    filled_asset_quantity: '0.25',
  };
  assert.equal(fillRatio(order), 0.5);
});

test('fillRatio reads whichever config object is present', () => {
  const order = {
    stop_limit_order_config: { asset_quantity: '2', limit_price: '1', stop_price: '1' },
    filled_asset_quantity: '2',
  };
  assert.equal(fillRatio(order), 1);
});

test('fillRatio treats a missing filled quantity as zero', () => {
  const order = { limit_order_config: { asset_quantity: '1' } };
  assert.equal(fillRatio(order), 0);
});

test('fillRatio returns null for a quote_amount order with no asset target', () => {
  const order = {
    limit_order_config: { quote_amount: '100', limit_price: '50000' },
    filled_asset_quantity: '0.002',
  };
  assert.equal(fillRatio(order), null);
});
/* built by nirholas x.com/nichxbt */
