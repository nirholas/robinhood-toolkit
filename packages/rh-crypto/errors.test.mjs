/**
 * robinhood-toolkit · tests for typed Robinhood Crypto errors
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { toRobinhoodError, triage } from './errors.mjs';

test('validation errors expose fields', () => {
  const error = toRobinhoodError({
    status: 400,
    method: 'POST',
    path: '/api/v1/crypto/trading/orders/',
    payload: {
      type: 'validation_error',
      errors: [
        { attr: 'client_order_id', detail: 'Enter a valid UUID.' },
        { attr: 'non_field_errors', detail: 'Insufficient buying power.' },
      ],
    },
  });
  assert.equal(error.isValidation, true);
  assert.deepEqual(error.byField.get('client_order_id'), ['Enter a valid UUID.']);
  assert.match(error.summary, /Insufficient buying power/);
  assert.equal(triage(error).retryable, false);
});

test('client errors carry null attr and still triage', () => {
  const error = toRobinhoodError({
    status: 403,
    method: 'POST',
    path: '/api/v1/crypto/trading/orders/',
    payload: { type: 'client_error', errors: [{ attr: null, detail: 'Not permitted.' }] },
  });
  assert.equal(error.byField.has('non_field_errors'), true, 'null attr must bucket, not vanish');
  assert.equal(triage(error).action, 'fix-permissions');
});

test('undocumented statuses are flagged, not retried', () => {
  const error = toRobinhoodError({ status: 418, method: 'GET', path: '/x', payload: null });
  assert.equal(triage(error).action, 'investigate');
  assert.equal(triage(error).retryable, false);
});

test('null or non-JSON payload on 5xx tolerates and stays retryable', () => {
  const error = toRobinhoodError({ status: 503, method: 'GET', path: '/x', payload: null });
  assert.deepEqual(error.errors, []);
  assert.equal(error.isServer, true);
  assert.equal(triage(error).retryable, true);
});

test('several validations in one response are all reported', () => {
  const error = toRobinhoodError({
    status: 400,
    method: 'POST',
    path: '/api/v1/crypto/trading/orders/',
    payload: {
      type: 'validation_error',
      errors: [
        { attr: 'symbol', detail: 'Must be uppercase.' },
        { attr: 'symbol', detail: 'Not currently tradable.' },
        { attr: 'client_order_id', detail: 'Enter a valid UUID.' },
      ],
    },
  });
  assert.deepEqual(error.byField.get('symbol'), ['Must be uppercase.', 'Not currently tradable.']);
  assert.equal(error.byField.size, 2);
});

test('429 backs off and is retryable', () => {
  const error = toRobinhoodError({ status: 429, method: 'GET', path: '/x', payload: null });
  const plan = triage(error);
  assert.equal(plan.action, 'back-off');
  assert.equal(plan.retryable, true);
  assert.equal(error.isRateLimit, true);
});

test('401 is auth, not validation', () => {
  const error = toRobinhoodError({ status: 401, method: 'GET', path: '/x', payload: null });
  assert.equal(error.isAuth, true);
  assert.equal(error.isValidation, false);
  assert.equal(triage(error).action, 'fix-auth');
});
