<!--
  robinhood-toolkit · build prompt: Robinhood Crypto API authentication
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 01 · Crypto API authentication

## Goal

Build a signed HTTP client for the Robinhood Crypto Trading API. Every other
prompt in this track imports it. When you are done, one function call issues an
authenticated request to any v1 or v2 endpoint and the signature is byte-exact.

## Prerequisites

- A Robinhood Crypto account in the United States. The API is US-only.
- Node 20 or newer. Ed25519 is in the standard `node:crypto` module, so this
  client has zero dependencies.
- API credentials created at <https://robinhood.com/account/crypto> on web
  classic. You generate the keypair locally and give Robinhood the public key.

## Reference facts

Verified against the live OpenAPI 3.0.1 spec served at
<https://docs.robinhood.com/crypto/trading> on 2026-07-20.

| Fact | Value |
|---|---|
| Base URL | `https://trading.robinhood.com` |
| Required headers | `x-api-key`, `x-signature`, `x-timestamp` |
| Signature algorithm | Ed25519, signature base64-encoded |
| Message to sign | `` `${api_key}${timestamp}${path}${method}${body}` `` |
| Timestamp | Unix seconds, **valid for 30 seconds only** |
| API key format | `rh-api-<uuid>` for keys issued after 2024-08-13; older keys have no prefix |
| Private key encoding | base64 of the raw 32-byte Ed25519 seed |
| Public key encoding | base64 of the raw 32-byte public key |

Rules that are easy to get wrong and are load-bearing:

- `path` in the signed message includes the query string. Sign
  `/api/v1/crypto/trading/holdings/?asset_code=BTC`, not the bare path.
- `method` is uppercase (`GET`, `POST`).
- For requests with no body, the body is omitted from the message, which is the
  same as appending an empty string.
- The signed body must be **byte-identical** to the bytes you transmit. Serialize
  once, sign that string, send that string. Do not serialize twice.

### Known-good test vector

Robinhood publishes a worked example. These are Robinhood's own published
throwaway demo keys, safe to hardcode in a test:

| Field | Value |
|---|---|
| Private key | `xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=` |
| Public key | `jPItx4TLjcnSUnmnXQQyAKL4eJj3+oWNNMmmm2vATqk=` |

Deriving the public key from that private seed must produce exactly the public
key above. That is the assertion your unit test should make, because it proves
your key-loading code is correct without depending on Robinhood's example body
string (see Gotchas for why the published signature is not reproducible).

## Steps

1. Generate a keypair. Write `packages/rh-crypto/keygen.mjs`:

```js
/**
 * robinhood-toolkit · Ed25519 keypair generator for Robinhood Crypto API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

// Strip DER wrappers to the raw 32-byte seed and 32-byte public key.
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16);
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);

console.log('private (keep secret):', seed.toString('base64'));
console.log('public  (give to RH) :', pub.toString('base64'));
```

Run it, then paste the public key into the "Add key" flow in your crypto account
settings. Robinhood returns the API key. Store both secrets outside the repo:

```sh
node packages/rh-crypto/keygen.mjs
# put the results in .env, which must be gitignored
printf 'RH_API_KEY=rh-api-...\nRH_PRIVATE_KEY=...\n' >> .env
```

2. Write the signer, `packages/rh-crypto/sign.mjs`:

```js
/**
 * robinhood-toolkit · request signer for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Load a base64 32-byte Ed25519 seed into a Node KeyObject. */
export function loadPrivateKey(base64Seed) {
  const seed = Buffer.from(base64Seed, 'base64');
  if (seed.length !== 32) {
    throw new Error(`private key must decode to 32 bytes, got ${seed.length}`);
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Derive the base64 public key from a private KeyObject. */
export function publicKeyBase64(privateKey) {
  return createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('base64');
}

/**
 * Build the three auth headers.
 * @param path full request path including query string, e.g. "/api/v1/crypto/trading/orders/"
 * @param body the exact serialized body string you will transmit, or "" for no body
 */
export function authHeaders({ apiKey, privateKey, method, path, body = '', timestamp }) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const message = `${apiKey}${ts}${path}${method.toUpperCase()}${body}`;
  return {
    'x-api-key': apiKey,
    'x-signature': sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64'),
    'x-timestamp': String(ts),
  };
}
```

3. Write the client, `packages/rh-crypto/client.mjs`:

```js
/**
 * robinhood-toolkit · authenticated client for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { authHeaders, loadPrivateKey } from './sign.mjs';

const BASE_URL = 'https://trading.robinhood.com';

export class RobinhoodCrypto {
  constructor({ apiKey = process.env.RH_API_KEY, privateKey = process.env.RH_PRIVATE_KEY } = {}) {
    if (!apiKey) throw new Error('RH_API_KEY is not set');
    if (!privateKey) throw new Error('RH_PRIVATE_KEY is not set');
    this.apiKey = apiKey;
    this.privateKey = loadPrivateKey(privateKey);
  }

  /**
   * @param path path with no query string, e.g. "/api/v1/crypto/trading/holdings/"
   * @param query object of query params; array values repeat the key
   * @param body plain object, or undefined
   */
  async request(method, path, { query, body } = {}) {
    const search = buildQuery(query);
    const fullPath = path + search;

    // Serialize exactly once. This same string is signed and transmitted.
    const payload = body === undefined ? '' : JSON.stringify(body);

    const headers = {
      ...authHeaders({
        apiKey: this.apiKey,
        privateKey: this.privateKey,
        method,
        path: fullPath,
        body: payload,
      }),
      'Content-Type': 'application/json',
    };

    const res = await fetch(BASE_URL + fullPath, {
      method: method.toUpperCase(),
      headers,
      body: payload === '' ? undefined : payload,
    });

    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!res.ok) {
      const err = new Error(`Robinhood ${res.status} on ${method} ${fullPath}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  }

  get(path, query) {
    return this.request('GET', path, { query });
  }

  post(path, body, query) {
    return this.request('POST', path, { body, query });
  }
}

/** Repeats a key for array values: {symbol:['BTC-USD','ETH-USD']} -> ?symbol=BTC-USD&symbol=ETH-USD */
export function buildQuery(query) {
  if (!query) return '';
  const parts = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
```

4. Write the test, `packages/rh-crypto/sign.test.mjs`:

```js
/**
 * robinhood-toolkit · signer tests
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
```

5. Smoke test against the live API, `examples/rh-whoami.mjs`:

```js
/**
 * robinhood-toolkit · verify Crypto API credentials end to end
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../packages/rh-crypto/client.mjs';

const rh = new RobinhoodCrypto();
const account = await rh.get('/api/v1/crypto/trading/accounts/');
console.log(account);
```

## Deliverable

- `packages/rh-crypto/keygen.mjs`
- `packages/rh-crypto/sign.mjs`
- `packages/rh-crypto/client.mjs`
- `packages/rh-crypto/sign.test.mjs`
- `packages/rh-crypto/README.md` describing exports and one runnable example
- `examples/rh-whoami.mjs`

## How to verify

```sh
node --test packages/rh-crypto/sign.test.mjs
node --env-file=.env examples/rh-whoami.mjs
```

The unit test must pass with no network access. The smoke test must print an
object with `account_number`, `status`, `buying_power`, and
`buying_power_currency`. A `401` means the signature or timestamp is wrong; a
`403` means the API key exists but lacks the permission you selected at key
creation time.

## Gotchas

- **The published example signature is not reproducible from JSON.** Robinhood's
  worked example signs the Python `str()` repr of a dict (single quotes, spaces
  after colons), not JSON. Verified: signing
  `{'client_order_id': '131de903-...', 'side': 'buy', ...}` reproduces the
  published signature exactly, while every JSON serialization of the same object
  does not. Do not treat that example as a JSON canonicalization spec. The rule
  that actually matters is that you sign the exact bytes you send. Robinhood's
  own reference Python client does this correctly: it signs `json.dumps(body)`
  and posts that same string.
- **Do not serialize twice.** `JSON.stringify(body)` for the signature and then
  passing the object to a library that re-serializes it is the single most common
  cause of intermittent 401s, because key order or spacing can differ.
- **The 30-second timestamp window is short.** Generate the timestamp immediately
  before the request, not at the top of a batch loop. If you retry, re-sign with a
  fresh timestamp rather than replaying the old headers.
- **Clock drift breaks auth silently.** A host clock more than 30 seconds off
  produces 401s that look like a bad key. Check with `date -u` against a known
  good source before debugging your signer.
- **Query strings are part of the signature.** If you build the URL and the signed
  path separately, they will drift. The client above derives both from one string.
- **The private key is a 32-byte seed, not a PKCS8 blob.** If you export from a
  library that emits PEM, convert to the raw seed first or `loadPrivateKey` will
  reject it.
- Keys are scoped at creation time. If you did not tick the order-placement
  permission, reads succeed and writes return 403. Re-create the credential to
  change scope.
