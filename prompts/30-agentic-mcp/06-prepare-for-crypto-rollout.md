<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: build the crypto adapter ahead of rollout
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 06 · Build the crypto lane before it ships

## Goal

Build and test the agentic crypto path **now**, against the MCP shape you can
already verify, so that it works the day the capability appears on your account.
Detect the capability at runtime rather than waiting on a date, and keep the
REST rail (track 20) serving crypto in the meantime.

## Prerequisites

- Prompt 03 (tool snapshot), 04 (policy guard), 05 (adapter).
- Track 20 complete, since it is the crypto path that works today.

## Reference facts

State of the world, verified 2026-07-20.

The Trading MCP today supports long equities and options orders. Robinhood's
wording: "You currently can use your agent to place long equities and options
orders. Note that we'll be adding support for more assets soon."

Agentic crypto is announced but **not live**: "Agentic Accounts for crypto will
begin rolling out soon to eligible US traders at no additional cost." When it
ships it runs through the **same** Trading MCP endpoint,
`https://agent.robinhood.com/mcp/trading`. There is no separate crypto MCP URL to
wait for.

That is the whole basis for building now. The endpoint, transport, OAuth flow,
session handling, tool-call envelope, and error semantics are all already
verifiable. The only unknowns are the tool names and their input schemas.

Two things follow, and this file exists to keep them straight:

1. **Crypto trading is not blocked.** The Robinhood Crypto Trading REST API
   (track 20) places real crypto orders today. Nothing in this file gates that.
   The MCP lane is an additional interface, not the crypto path.
2. **You cannot know the crypto tool names in advance.** No crypto tool schema is
   published. Do not write `place_crypto_order` into your code and wait for it to
   start working. Detect by capability, per prompt 05.

UNVERIFIED, and unknowable from outside: the crypto tool names, their input
schemas, whether a `review_crypto_order` analogue to the documented
`review_equity_order` will exist, which symbols will be supported, and the
rollout date for any specific account. Every one of these must come from a live
`tools/list` on your own account.

## Steps

1. Extend the capability map in `packages/rh-mcp/adapter.mjs` with crypto
   capabilities defined by schema shape rather than by name:

```js
/**
 * robinhood-toolkit · crypto capability detection for the Trading MCP
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/** Does this tool's schema look like it accepts a crypto pair such as BTC-USD? */
export function acceptsCryptoPair(tool) {
  const properties = tool.inputSchema?.properties ?? {};
  const symbol = properties.symbol ?? properties.pair ?? properties.currency_pair;
  if (!symbol) return false;

  // An explicit enum is the strongest signal available.
  if (Array.isArray(symbol.enum)) return symbol.enum.some((v) => /^[A-Z]{2,10}-[A-Z]{3,5}$/.test(v));

  const hints = `${tool.name} ${tool.description ?? ''} ${symbol.description ?? ''}`;
  if (/crypto|BTC|ETH|-USD pair|currency pair/i.test(hints)) return true;
  if (Array.isArray(properties.asset_class?.enum)) {
    return properties.asset_class.enum.some((v) => /crypto/i.test(v));
  }
  return false;
}

export const CRYPTO_CAPABILITIES = {
  cryptoPlaceOrder: (t) => acceptsCryptoPair(t) && /place|submit|buy|sell|trade|order/i.test(t.name) && !/cancel|review|simulate/i.test(t.name),
  cryptoReviewOrder: (t) => acceptsCryptoPair(t) && /review|simulate|preview|validate/i.test(t.name),
  cryptoCancelOrder: (t) => acceptsCryptoPair(t) && /cancel/i.test(t.name),
  cryptoPositions: (t) => /crypto/i.test(`${t.name} ${t.description ?? ''}`) && /position|holding|balance/i.test(t.name),
};
```

Merge `CRYPTO_CAPABILITIES` into `CAPABILITIES` so `adapter.has('cryptoPlaceOrder')`
works with no other changes.

2. Build the runtime detector. This is the piece that turns "wait for an
   announcement" into "the code notices". `packages/rh-mcp/crypto-readiness.mjs`:

```js
/**
 * robinhood-toolkit · detect agentic crypto availability at runtime
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { readFile, writeFile } from 'node:fs/promises';

const STATE = 'docs/mcp/crypto-readiness.json';

/**
 * @returns {{available: boolean, capabilities: object, tools: string[], checked_at: string}}
 */
export function assessCryptoReadiness(adapter) {
  const capabilities = {
    cryptoPlaceOrder: adapter.has('cryptoPlaceOrder'),
    cryptoReviewOrder: adapter.has('cryptoReviewOrder'),
    cryptoCancelOrder: adapter.has('cryptoCancelOrder'),
    cryptoPositions: adapter.has('cryptoPositions'),
  };
  return {
    checked_at: new Date().toISOString(),
    available: capabilities.cryptoPlaceOrder,
    capabilities,
    tools: Object.entries(capabilities)
      .filter(([, present]) => present)
      .map(([capability]) => `${capability} -> ${adapter.resolve(capability).name}`),
  };
}

/** Persist and report whether readiness changed since the last check. */
export async function recordReadiness(assessment) {
  let previous = null;
  try {
    previous = JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    previous = null;
  }
  await writeFile(STATE, `${JSON.stringify(assessment, null, 2)}\n`);
  const became = assessment.available && previous?.available === false;
  const lost = previous?.available === true && !assessment.available;
  return { became, lost, previous };
}
```

3. Write the poller you can run on a schedule. `examples/mcp-crypto-watch.mjs`:

```js
/**
 * robinhood-toolkit · notice when agentic crypto lights up on this account
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { RobinhoodMCPAdapter } from '../packages/rh-mcp/adapter.mjs';
import { assessCryptoReadiness, recordReadiness } from '../packages/rh-mcp/crypto-readiness.mjs';

const adapter = await RobinhoodMCPAdapter.open();
const assessment = assessCryptoReadiness(adapter);
const { became, lost } = await recordReadiness(assessment);
await adapter.close();

if (became) {
  console.log('AGENTIC CRYPTO IS NOW AVAILABLE on this account.');
  console.log(assessment.tools.join('\n'));
  console.log('\nRe-run enumerate.mjs to refresh the snapshot, then review the new schemas before enabling writes.');
  process.exitCode = 10; // distinct code so a scheduler can alert on it
} else if (lost) {
  console.log('Crypto capability disappeared. Investigate before trading.');
  process.exitCode = 11;
} else {
  console.log(`crypto available: ${assessment.available}`);
}
```

Run it on a schedule (cron, a systemd timer, whatever you already use). Exit code
10 is the signal to act. Do not add a hardcoded date anywhere.

4. Route by capability, not by assumption. Your application should ask the
   adapter and fall back to the REST rail, which works today:

```js
/**
 * robinhood-toolkit · route crypto orders to whichever rail is available
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { RobinhoodCrypto } from '../rh-crypto/client.mjs';
import { buildOrder } from '../rh-crypto/orders.mjs';

export async function placeCryptoOrder(adapter, { symbol, side, type, config }) {
  if (adapter?.has('cryptoPlaceOrder')) {
    // MCP lane. Schemas are unknown until rollout, so validate against the live
    // schema (the adapter does this) rather than guessing argument names here.
    const tool = adapter.resolve('cryptoPlaceOrder');
    const args = mapToSchema(tool.inputSchema, { symbol, side, type, config });
    return { rail: 'mcp', result: await adapter.call('cryptoPlaceOrder', args) };
  }

  // REST lane. This works today and is the default.
  const rh = new RobinhoodCrypto();
  const body = buildOrder({ symbol, side, type, config });
  return { rail: 'rest', result: await rh.post('/api/v1/crypto/trading/orders/', body) };
}

/**
 * Map canonical fields onto whatever property names the live schema advertises.
 * Throws if a required property cannot be satisfied, so an unmapped rollout
 * fails loudly instead of sending a malformed order.
 */
export function mapToSchema(schema, canonical) {
  const properties = schema?.properties ?? {};
  const aliases = {
    symbol: ['symbol', 'pair', 'currency_pair', 'ticker'],
    side: ['side', 'direction', 'action'],
    type: ['type', 'order_type'],
  };

  const args = {};
  for (const [field, candidates] of Object.entries(aliases)) {
    const key = candidates.find((c) => c in properties);
    if (key) args[key] = canonical[field];
  }
  if (canonical.config) {
    for (const [k, v] of Object.entries(canonical.config)) {
      if (k in properties) args[k] = v;
    }
  }

  const missing = (schema?.required ?? []).filter((r) => args[r] === undefined);
  if (missing.length) {
    throw new Error(
      `cannot map canonical order onto ${JSON.stringify(missing)}; inspect the live schema and extend the alias table`,
    );
  }
  return args;
}
```

5. Test the MCP lane now, without crypto, using a fixture. This is what makes the
   claim "it will work on rollout" real rather than aspirational: run your adapter,
   policy guard, and routing against a simulated crypto tool list.

## Deliverable

- `CRYPTO_CAPABILITIES` and `acceptsCryptoPair` merged into the adapter
- `packages/rh-mcp/crypto-readiness.mjs`
- `examples/mcp-crypto-watch.mjs` on a schedule, alerting on exit code 10
- `placeCryptoOrder` routing with REST as the working default
- `docs/mcp/crypto-readiness.json`, committed, showing the current answer
- Fixture-driven tests proving the MCP lane works when the capability appears

## How to verify

```sh
node examples/mcp-crypto-watch.mjs
```

Today this must print `crypto available: false` and write the state file. That is
the correct result, not a failure.

The real verification is the fixture test, which must pass now:

```js
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { RobinhoodMCPAdapter } from './adapter.mjs';
import { assessCryptoReadiness } from './crypto-readiness.mjs';
import { mapToSchema } from './route.mjs';

const cryptoFixture = [
  {
    name: 'place_crypto_order',
    description: 'Place a crypto order in the agentic account.',
    inputSchema: {
      type: 'object',
      required: ['pair', 'side', 'order_type'],
      properties: {
        pair: { type: 'string', enum: ['BTC-USD', 'ETH-USD'] },
        side: { type: 'string', enum: ['buy', 'sell'] },
        order_type: { type: 'string', enum: ['market', 'limit'] },
        asset_quantity: { type: 'string' },
      },
    },
  },
];

test('detects crypto capability from a schema with a different property name', () => {
  const adapter = new RobinhoodMCPAdapter({ client: { callTool: async () => ({}), close: async () => {} }, tools: cryptoFixture });
  const assessment = assessCryptoReadiness(adapter);
  assert.equal(assessment.available, true);
  assert.equal(adapter.resolve('cryptoPlaceOrder').name, 'place_crypto_order');
});

test('maps canonical fields onto the advertised property names', () => {
  const args = mapToSchema(cryptoFixture[0].inputSchema, {
    symbol: 'BTC-USD',
    side: 'buy',
    type: 'market',
    config: { asset_quantity: '0.001' },
  });
  assert.deepEqual(args, { pair: 'BTC-USD', side: 'buy', order_type: 'market', asset_quantity: '0.001' });
});

test('unmappable required fields fail loudly', () => {
  const schema = { type: 'object', required: ['account_token'], properties: { account_token: { type: 'string' } } };
  assert.throws(() => mapToSchema(schema, { symbol: 'BTC-USD', side: 'buy' }), /extend the alias table/);
});
```

Note the fixture deliberately uses `pair` and `order_type` rather than `symbol`
and `type`. If your code only passes with the names you expected, it is not ready
for a rollout whose naming you do not control.

## Gotchas

- **Crypto trading is not blocked today.** The REST API in track 20 places real
  crypto orders right now. Do not present the MCP rollout as a prerequisite for
  crypto, and do not stall crypto work waiting for it. MCP is an additional
  interface.
- **Do not hardcode `place_crypto_order` or any other guessed name.** It is a
  plausible name, which makes it more dangerous than an obviously wrong one:
  it will look correct in review and silently never match.
- **Do not hardcode a rollout date.** Rollouts are staged per account and
  eligibility. The detector is the answer; a calendar entry is not.
- **Capability appearing is not permission to trade.** When exit code 10 fires,
  the correct next step is to re-run the enumerator, read the new schemas, extend
  the policy guard for crypto notionals, and test with the smallest possible size.
  Not to flip a flag and let a loop run.
- **The alias table will be incomplete.** That is why `mapToSchema` throws on
  unmapped required fields instead of sending a partial order. A loud failure at
  rollout is the design goal.
- **`acceptsCryptoPair` can false-positive.** An equities tool whose description
  happens to mention crypto could match. Before enabling writes on a newly
  detected capability, read the tool description in your snapshot yourself.
- **Guardrails do not carry over automatically.** Your prompt-04 policy caps a
  notional in USD; a crypto order sized in `asset_quantity` needs converting
  before the cap means anything. Extend the guard when the capability lands.
- Robinhood does not supervise, monitor, or audit your agent on this rail either.
  The rollout does not change that.
<!-- built by nirholas x.com/nichxbt -->
