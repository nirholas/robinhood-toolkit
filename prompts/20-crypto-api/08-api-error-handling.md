<!--
  robinhood-toolkit · build prompt: API error handling
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 08 · API error handling

## Goal

Turn Robinhood's error envelope into typed, actionable errors: field-level
validation failures attached to the field that caused them, and a triage table
that maps every documented status code to the one correct response.

## Prerequisites

- Prompts 01 and 07.

## Reference facts

Verified against the live spec on 2026-07-20.

### Envelope

`ErrorResponse` has two fields:

- `type`: one of `validation_error`, `client_error`, `server_error`
- `errors[]`: each item has `detail` and `attr`

Mapping of `type` to status, quoted from the spec:

| Error type | Status codes |
|---|---|
| `validation_error` | 400 |
| `client_error` | 4XX, excluding 400 |
| `server_error` | 5XX |

Field semantics, quoted:

> `attr`: Error types of `validation_error` will specify the field name or
> `non_field_errors` if the error cannot be attributed to a field. Will be `null`
> for error types of either `client_error` and `server_error`.
>
> `detail`: Will contain a human readable string describing the error.

So `attr` is only meaningful on 400. On every other error it is null by design,
and code that keys off `attr` to route errors will silently fall through on 401s
and 500s.

### Documented status codes

| Status | Meaning |
|---|---|
| 400 | Bad request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not found |
| 405 | Method not allowed |
| 406 | Not acceptable |
| 415 | Unsupported media type |
| 429 | Too many requests |
| 500 | Internal server error |
| 503 | Service unavailable |

### Example, from the spec

A `validation_error` raised on the Add Crypto Order endpoint because
`client_order_id` held an unexpected value. The `errors` list carries one item
per problem, each naming its `attr`.

## Steps

1. Write `packages/rh-crypto/errors.mjs`:

```js
/**
 * robinhood-toolkit · typed errors for the Robinhood Crypto Trading API
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

export class RobinhoodError extends Error {
  constructor(message, { status, type, errors = [], method, path, headers } = {}) {
    super(message);
    this.name = 'RobinhoodError';
    this.status = status;
    this.type = type;
    this.errors = errors;
    this.method = method;
    this.path = path;
    this.headers = headers;
  }

  /** Field-level details keyed by attr. Only populated on validation errors. */
  get byField() {
    const map = new Map();
    for (const e of this.errors) {
      const key = e.attr ?? 'non_field_errors';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e.detail);
    }
    return map;
  }

  get isValidation() {
    return this.type === 'validation_error' || this.status === 400;
  }

  get isAuth() {
    return this.status === 401;
  }

  get isPermission() {
    return this.status === 403;
  }

  get isRateLimit() {
    return this.status === 429;
  }

  get isServer() {
    return this.status >= 500;
  }

  /** One line a human can act on. */
  get summary() {
    const parts = [...this.byField].map(([field, details]) =>
      field === 'non_field_errors' ? details.join('; ') : `${field}: ${details.join('; ')}`,
    );
    return parts.length ? parts.join(' | ') : this.message;
  }
}

/** Build a RobinhoodError from a non-2xx response. */
export function toRobinhoodError({ status, payload, method, path, headers }) {
  const type = payload?.type;
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const error = new RobinhoodError(`Robinhood ${status} on ${method} ${path}`, {
    status,
    type,
    errors,
    method,
    path,
    headers,
  });
  return error;
}

/**
 * What the caller should do. Deliberately exhaustive over the documented codes
 * so a new code shows up as 'investigate' rather than being silently retried.
 */
export function triage(error) {
  switch (error.status) {
    case 400:
      return { action: 'fix-request', retryable: false, hint: error.summary };
    case 401:
      return {
        action: 'fix-auth',
        retryable: false,
        hint: 'Signature, timestamp, or key is wrong. Check clock drift and that the signed path includes the query string.',
      };
    case 403:
      return {
        action: 'fix-permissions',
        retryable: false,
        hint: 'Key is valid but lacks this scope. Re-create the credential with the required permission.',
      };
    case 404:
      return { action: 'fix-request', retryable: false, hint: 'Unknown path or resource id.' };
    case 405:
      return { action: 'fix-request', retryable: false, hint: 'Wrong HTTP method for this path.' };
    case 406:
      return { action: 'fix-request', retryable: false, hint: 'Adjust the Accept header.' };
    case 415:
      return { action: 'fix-request', retryable: false, hint: 'Set Content-Type: application/json.' };
    case 429:
      return { action: 'back-off', retryable: true, hint: 'Rate limited. Honor Retry-After if present.' };
    case 500:
    case 503:
      return { action: 'retry-if-idempotent', retryable: true, hint: 'Transient. Only retry GETs and orders carrying a reused client_order_id.' };
    default:
      return { action: 'investigate', retryable: false, hint: `Undocumented status ${error.status}.` };
  }
}
```

2. Use it in the client. Replace the inline throw in `request()`:

```js
import { toRobinhoodError } from './errors.mjs';

if (!res.ok) {
  throw toRobinhoodError({
    status: res.status,
    payload: parsed,
    method: method.toUpperCase(),
    path: fullPath,
    headers: res.headers,
  });
}
```

3. Handle validation errors where you can act on them. Field-level routing is the
   point of `attr`:

```js
/**
 * robinhood-toolkit · order submission with actionable error handling
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { RobinhoodError, triage } from '../packages/rh-crypto/errors.mjs';

try {
  await rh.requestWithPolicy('POST', '/api/v1/crypto/trading/orders/', { body, idempotent: true });
} catch (error) {
  if (!(error instanceof RobinhoodError)) throw error;

  const plan = triage(error);
  console.error(`[${plan.action}] ${plan.hint}`);

  for (const [field, details] of error.byField) {
    switch (field) {
      case 'client_order_id':
        console.error('This id was already used. Reuse it only for retries of the same order.');
        break;
      case 'market_order_config':
      case 'limit_order_config':
        console.error('Config object does not match the declared order type.');
        break;
      case 'symbol':
        console.error('Symbol must be uppercase and currently tradable.');
        break;
      case 'non_field_errors':
        console.error(`Request-level problem: ${details.join('; ')}`);
        break;
      default:
        console.error(`${field}: ${details.join('; ')}`);
    }
  }
  if (!plan.retryable) process.exitCode = 1;
}
```

4. Log errors in a form you can grep later. Never log the signature or private
   key:

```js
/**
 * robinhood-toolkit · safe error logging
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function logError(error) {
  const record = {
    at: new Date().toISOString(),
    status: error.status,
    type: error.type,
    method: error.method,
    path: error.path,
    fields: Object.fromEntries(error.byField ?? []),
    action: triage(error).action,
  };
  console.error(JSON.stringify(record));
}
```

## Deliverable

- `packages/rh-crypto/errors.mjs` exporting `RobinhoodError`,
  `toRobinhoodError`, `triage`
- `logError` helper that never emits credentials
- `request()` updated to throw `RobinhoodError`
- Tests over fixture payloads, no network required

## How to verify

```sh
node --test packages/rh-crypto/errors.test.mjs
```

The test must assert against a real-shaped envelope:

```js
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
```

Live, provoke each class at least once and confirm the triage output is correct:
send a lowercase symbol (400), corrupt the signature (401), use a read-only key
to POST (403), and hammer an endpoint past the budget (429).

## Gotchas

- **`attr` is null except on 400.** Code that groups purely by `attr` drops every
  non-validation error on the floor. `byField` buckets nulls into
  `non_field_errors` so nothing disappears.
- **`errors` is a list.** One request can fail several validations at once.
  Reading `errors[0]` shows the user one problem, they fix it, and the next
  attempt surfaces the next one. Report all of them.
- **A 401 usually is not a bad key.** In practice it is clock drift past the
  30-second window, or a signed path that omitted the query string. Check those
  two before regenerating credentials.
- **403 with working reads means scope, not auth.** Key permissions are chosen at
  creation time and cannot be edited; create a new credential.
- **Never log `x-signature` or the private key.** Signatures are per-request so
  leaking one is not catastrophic, but logs get shipped to third parties and the
  habit is what matters. `logError` omits headers entirely.
- **Do not parse `detail` strings to make control-flow decisions.** They are
  human-readable and will change. Branch on `status`, `type`, and `attr`.
- **An empty or non-JSON body on a 5xx is normal.** Gateways return HTML. The
  client must tolerate a `payload` of `null`, which is why `toRobinhoodError`
  defaults `errors` to an empty array rather than indexing into it.
