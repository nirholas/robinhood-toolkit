/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · policy guard rule tests (offline)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { PolicyGuard, PolicyViolation } from './policy.mjs';

const policy = {
  agentic_account_funded_usd: 500,
  max_order_notional_usd: 50,
  max_orders_per_day: 2,
  max_position_concentration: 0.25,
  allowed_symbols: ['BTC-USD'],
  require_simulation_before_write: true,
};
const ok = { tool: 'x', symbol: 'BTC-USD', side: 'buy', notionalUsd: 10, portfolioValueUsd: 500, simulated: true };

test('accepts a compliant intent', () => {
  assert.doesNotThrow(() => new PolicyGuard(policy, { auditLog() {} }).check(ok));
});

test('rejects an off-list symbol', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, symbol: 'DOGE-USD' }), PolicyViolation);
});

test('rejects an oversized order', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, notionalUsd: 51 }), /max_order_notional_usd/);
});

test('rejects a non-positive notional', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, notionalUsd: 0 }), /notional/);
});

test('rejects an unsimulated write', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, simulated: false }), /require_simulation_before_write/);
});

test('daily count only advances on success', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  guard.check(ok);
  assert.equal(guard.ordersToday, 0, 'checking must not consume budget');
  guard.recordPlaced(ok);
  guard.recordPlaced(ok);
  assert.throws(() => guard.check(ok), /max_orders_per_day/);
});

test('rejects excessive concentration', () => {
  const guard = new PolicyGuard(policy, { auditLog() {} });
  assert.throws(() => guard.check({ ...ok, notionalUsd: 49, portfolioValueUsd: 100 }), /concentration/);
});
/* built by nirholas x.com/nichxbt */
