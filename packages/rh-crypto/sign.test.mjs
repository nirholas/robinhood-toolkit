/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · signer tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { authHeaders, loadPrivateKey, publicKeyBase64 } from './sign.mjs';
import { buildQuery } from './client.mjs';

// Robinhood's published demo keypair.
const DEMO_PRIVATE = 'xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=';
const DEMO_PUBLIC = 'jPItx4TLjcnSUnmnXQQyAKL4eJj3+oWNNMmmm2vATqk=';

test('derives the documented public key from the documented private key', () => {
  assert.equal(publicKeyBase64(loadPrivateKey(DEMO_PRIVATE)), DEMO_PUBLIC);
});

test('rejects a malformed private key', () => {
  assert.throws(() => loadPrivateKey('c2hvcnQ='), /32 bytes/);
});

test('signature is deterministic and pinned to the exact message', () => {
  const key = loadPrivateKey(DEMO_PRIVATE);
  const base = {
    apiKey: 'rh-api-6148effc-c0b1-486c-8940-a1d099456be6',
    privateKey: key,
    method: 'GET',
    path: '/api/v1/crypto/trading/accounts/',
    timestamp: 1698708981,
  };
  const a = authHeaders(base);
  const b = authHeaders(base);
  assert.equal(a['x-signature'], b['x-signature'], 'Ed25519 must be deterministic');

  // A one-character path change must change the signature.
  const c = authHeaders({ ...base, path: '/api/v2/crypto/trading/accounts/' });
  assert.notEqual(a['x-signature'], c['x-signature']);

  assert.equal(a['x-timestamp'], '1698708981');
  assert.equal(a['x-api-key'], base.apiKey);
});

test('array query params repeat the key', () => {
  assert.equal(buildQuery({ symbol: ['BTC-USD', 'ETH-USD'] }), '?symbol=BTC-USD&symbol=ETH-USD');
  assert.equal(buildQuery({}), '');
  assert.equal(buildQuery(undefined), '');
});
/* built by nirholas x.com/nichxbt */
