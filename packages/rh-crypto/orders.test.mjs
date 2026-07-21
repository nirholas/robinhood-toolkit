/**
 * robinhood-toolkit · unit tests for order-building helpers
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Pure functions only. Runs with no network, no key, no spend:
 *   node --test packages/rh-crypto/orders.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertStopSane,
  assertTradable,
  buildOrder,
  limitConfig,
  marketConfig,
  ORDER_TYPES,
  roundToIncrement,
  stopLimitConfig,
  stopLossConfig,
  TIME_IN_FORCE,
} from './orders.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('buildOrder produces a well-formed market body', () => {
  const body = buildOrder({
    symbol: 'BTC-USD',
    side: 'buy',
    type: 'market',
    config: { asset_quantity: '0.0001' },
    clientOrderId: 'fixed-id',
  });
  assert.deepEqual(body, {
    client_order_id: 'fixed-id',
    side: 'buy',
    symbol: 'BTC-USD',
    type: 'market',
    market_order_config: { asset_quantity: '0.0001' },
  });
});

test('buildOrder derives the config key from the type', () => {
  for (const type of ORDER_TYPES) {
    const body = buildOrder({ symbol: 'ETH-USD', side: 'sell', type, config: {} });
    assert.ok(`${type}_order_config` in body, `expected ${type}_order_config key`);
    // exactly one config object is attached
    const configKeys = Object.keys(body).filter((k) => k.endsWith('_order_config'));
    assert.deepEqual(configKeys, [`${type}_order_config`]);
  }
});

test('buildOrder generates a UUID client_order_id when none is given', () => {
  const a = buildOrder({ symbol: 'BTC-USD', side: 'buy', type: 'market', config: {} });
  const b = buildOrder({ symbol: 'BTC-USD', side: 'buy', type: 'market', config: {} });
  assert.match(a.client_order_id, UUID_RE);
  assert.match(b.client_order_id, UUID_RE);
  assert.notEqual(a.client_order_id, b.client_order_id);
});

test('buildOrder rejects a lowercase or empty symbol', () => {
  assert.throws(() => buildOrder({ symbol: 'btc-usd', side: 'buy', type: 'market', config: {} }), /uppercase/);
  assert.throws(() => buildOrder({ symbol: '', side: 'buy', type: 'market', config: {} }), /uppercase/);
  assert.throws(() => buildOrder({ side: 'buy', type: 'market', config: {} }), /uppercase/);
});

test('buildOrder rejects a bad side', () => {
  assert.throws(() => buildOrder({ symbol: 'BTC-USD', side: 'BUY', type: 'market', config: {} }), /side must be/);
  assert.throws(() => buildOrder({ symbol: 'BTC-USD', side: 'long', type: 'market', config: {} }), /side must be/);
});

test('buildOrder rejects an unknown type', () => {
  assert.throws(() => buildOrder({ symbol: 'BTC-USD', side: 'buy', type: 'trailing_stop', config: {} }), /type must be one of/);
});

test('buildOrder requires a config object', () => {
  assert.throws(() => buildOrder({ symbol: 'BTC-USD', side: 'buy', type: 'market' }), /require a config object/);
  assert.throws(() => buildOrder({ symbol: 'BTC-USD', side: 'buy', type: 'market', config: null }), /require a config object/);
  assert.throws(() => buildOrder({ symbol: 'BTC-USD', side: 'buy', type: 'market', config: 'x' }), /require a config object/);
});

test('roundToIncrement floors to the increment and keeps its precision', () => {
  assert.equal(roundToIncrement('1.23456789', '0.0001'), '1.2345');
  assert.equal(roundToIncrement('0.5', '0.01'), '0.50');
  assert.equal(roundToIncrement('0.000123', '0.00000001'), '0.00012300');
  assert.equal(roundToIncrement('3', '1'), '3');
});

test('roundToIncrement rounds down, never up', () => {
  // 0.19999 in steps of 0.1 is one step, not two.
  assert.equal(roundToIncrement('0.19999', '0.1'), '0.1');
  // 0.99 in steps of 0.25 floors to 0.75.
  assert.equal(roundToIncrement('0.99', '0.25'), '0.75');
});

test('roundToIncrement rejects a non-positive increment', () => {
  assert.throws(() => roundToIncrement('1', '0'), /invalid increment/);
  assert.throws(() => roundToIncrement('1', '-0.1'), /invalid increment/);
});

const PAIR = {
  symbol: 'BTC-USD',
  status: 'tradable',
  min_order_size: '0.0001',
  max_order_size: '10',
};

test('assertTradable accepts a quantity within bounds', () => {
  assert.doesNotThrow(() => assertTradable(PAIR, { side: 'buy', quantity: '0.0001' }));
  assert.doesNotThrow(() => assertTradable(PAIR, { side: 'sell', quantity: '5' }));
});

test('assertTradable rejects a missing pair', () => {
  assert.throws(() => assertTradable(null, { side: 'buy', quantity: '1' }), /unknown trading pair/);
  assert.throws(() => assertTradable(undefined, { side: 'buy', quantity: '1' }), /unknown trading pair/);
});

test('assertTradable rejects an untradable pair', () => {
  const pair = { ...PAIR, status: 'untradable' };
  assert.throws(() => assertTradable(pair, { side: 'buy', quantity: '0.001' }), /untradable/);
});

test('assertTradable blocks buys on a sell-only pair but allows sells', () => {
  const pair = { ...PAIR, status: 'sellonly' };
  assert.throws(() => assertTradable(pair, { side: 'buy', quantity: '0.001' }), /sell-only/);
  assert.doesNotThrow(() => assertTradable(pair, { side: 'sell', quantity: '0.001' }));
});

test('assertTradable enforces min and max order size', () => {
  assert.throws(() => assertTradable(PAIR, { side: 'buy', quantity: '0.00001' }), /below min_order_size/);
  assert.throws(() => assertTradable(PAIR, { side: 'buy', quantity: '20' }), /above max_order_size/);
});

// --- prompt 04: order configuration builders -------------------------------

test('marketConfig requires asset_quantity and stringifies it', () => {
  assert.deepEqual(marketConfig({ assetQuantity: 0.0001 }), { asset_quantity: '0.0001' });
  assert.throws(() => marketConfig({}), /require assetQuantity/);
});

test('sizing accepts exactly one of assetQuantity or quoteAmount', () => {
  // asset only
  assert.deepEqual(limitConfig({ assetQuantity: '0.01', limitPrice: '50000' }), {
    asset_quantity: '0.01',
    limit_price: '50000',
  });
  // quote only
  assert.deepEqual(limitConfig({ quoteAmount: '100', limitPrice: '50000' }), {
    quote_amount: '100',
    limit_price: '50000',
  });
});

test('sizing rejects supplying both or neither', () => {
  assert.throws(
    () => limitConfig({ assetQuantity: '0.01', quoteAmount: '100', limitPrice: '50000' }),
    /exactly one of assetQuantity or quoteAmount/,
  );
  assert.throws(() => limitConfig({ limitPrice: '50000' }), /exactly one of assetQuantity or quoteAmount/);
});

test('limitConfig requires a limitPrice', () => {
  assert.throws(() => limitConfig({ assetQuantity: '0.01' }), /require limitPrice/);
});

test('stopLossConfig defaults time_in_force to gtc and stringifies the stop', () => {
  assert.deepEqual(stopLossConfig({ assetQuantity: '0.01', stopPrice: 45000 }), {
    asset_quantity: '0.01',
    stop_price: '45000',
    time_in_force: 'gtc',
  });
  assert.throws(() => stopLossConfig({ assetQuantity: '0.01' }), /require stopPrice/);
});

test('stopLimitConfig carries both prices and a valid time_in_force', () => {
  assert.deepEqual(
    stopLimitConfig({ assetQuantity: '0.01', limitPrice: '44000', stopPrice: '45000', timeInForce: 'gfd' }),
    {
      asset_quantity: '0.01',
      limit_price: '44000',
      stop_price: '45000',
      time_in_force: 'gfd',
    },
  );
  assert.throws(() => stopLimitConfig({ assetQuantity: '0.01', stopPrice: '45000' }), /require limitPrice/);
  assert.throws(() => stopLimitConfig({ assetQuantity: '0.01', limitPrice: '44000' }), /require stopPrice/);
});

test('a bad time_in_force is rejected', () => {
  assert.throws(
    () => stopLossConfig({ assetQuantity: '0.01', stopPrice: '45000', timeInForce: 'ioc' }),
    /time_in_force must be one of/,
  );
  assert.throws(
    () => stopLimitConfig({ assetQuantity: '0.01', limitPrice: '44000', stopPrice: '45000', timeInForce: 'day' }),
    /time_in_force must be one of/,
  );
  // Every documented value is accepted.
  for (const tif of TIME_IN_FORCE) {
    assert.doesNotThrow(() => stopLossConfig({ assetQuantity: '0.01', stopPrice: '45000', timeInForce: tif }));
  }
});

test('assertStopSane catches a sell stop at or above the last price', () => {
  // Sell stop above market would trigger immediately.
  assert.throws(
    () => assertStopSane({ side: 'sell', stopPrice: '110', lastPrice: '100' }),
    /trigger immediately/,
  );
  assert.throws(
    () => assertStopSane({ side: 'sell', stopPrice: '100', lastPrice: '100' }),
    /trigger immediately/,
  );
  // A sell stop below market is fine.
  assert.doesNotThrow(() => assertStopSane({ side: 'sell', stopPrice: '90', lastPrice: '100' }));
});

test('assertStopSane catches a buy stop at or below the last price', () => {
  assert.throws(
    () => assertStopSane({ side: 'buy', stopPrice: '90', lastPrice: '100' }),
    /trigger immediately/,
  );
  assert.doesNotThrow(() => assertStopSane({ side: 'buy', stopPrice: '110', lastPrice: '100' }));
});

test('assertStopSane flags a stop-limit whose limit can never fill', () => {
  // Sell stop-limit: a limit above the stop may never fill on a downward break.
  assert.throws(
    () => assertStopSane({ side: 'sell', stopPrice: '90', limitPrice: '95', lastPrice: '100' }),
    /may never fill/,
  );
  // Buy stop-limit: a limit below the stop may never fill on an upward break.
  assert.throws(
    () => assertStopSane({ side: 'buy', stopPrice: '110', limitPrice: '105', lastPrice: '100' }),
    /may never fill/,
  );
  // A protective limit on the correct side of the stop is fine.
  assert.doesNotThrow(() => assertStopSane({ side: 'sell', stopPrice: '90', limitPrice: '89', lastPrice: '100' }));
});
