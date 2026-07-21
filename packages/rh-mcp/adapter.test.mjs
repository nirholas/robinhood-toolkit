/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · schema-driven adapter tests (offline, no network)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  CAPABILITIES,
  RobinhoodMCPAdapter,
  ToolCallFailed,
  ToolUnavailable,
  isWrite,
  textOf,
} from './adapter.mjs';

const fixture = [
  {
    name: 'review_equity_order',
    description: 'Simulate an order and return pre-trade warnings.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side'],
      properties: { symbol: { type: 'string' }, side: { type: 'string', enum: ['buy', 'sell'] } },
    },
  },
];

/** A fuller surface, closer to what enumerate.mjs actually returns live. */
const surface = [
  { name: 'get_positions', description: 'List current equity positions.', inputSchema: { type: 'object' } },
  { name: 'get_accounts', description: 'List brokerage accounts.', inputSchema: { type: 'object' } },
  {
    name: 'list_orders',
    description: 'List recent orders.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
  },
  {
    name: 'review_equity_order',
    description: 'Simulate an order and return pre-trade warnings.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side'],
      additionalProperties: false,
      properties: {
        symbol: { type: 'string' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        notional_usd: { type: 'number' },
      },
    },
  },
  {
    name: 'place_equity_order',
    description: 'Submit an equity order.',
    inputSchema: {
      type: 'object',
      required: ['symbol', 'side', 'notional_usd'],
      additionalProperties: false,
      properties: {
        symbol: { type: 'string' },
        side: { type: 'string', enum: ['buy', 'sell'] },
        notional_usd: { type: 'number' },
      },
    },
  },
  { name: 'cancel_order', description: 'Cancel an open order.', inputSchema: { type: 'object', required: ['order_id'], properties: { order_id: { type: 'string' } } } },
];

function adapterWith(tools, callTool, guard = null) {
  return new RobinhoodMCPAdapter({ client: { callTool, close: async () => {} }, tools, guard });
}

test('resolves a capability by schema, not by hardcoded name', () => {
  const a = adapterWith(fixture, async () => ({ content: [] }));
  assert.equal(a.resolve('reviewOrder').name, 'review_equity_order');
});

test('missing capability throws with the available list', () => {
  const a = adapterWith(fixture, async () => ({ content: [] }));
  assert.throws(() => a.resolve('cancelOrder'), ToolUnavailable);
  assert.equal(a.has('cancelOrder'), false);
});

test('unknown capability name is a programmer error, not ToolUnavailable', () => {
  const a = adapterWith(fixture, async () => ({ content: [] }));
  assert.throws(() => a.resolve('teleport'), /unknown capability: teleport/);
});

test('rejects arguments the schema does not allow', async () => {
  const a = adapterWith(fixture, async () => ({ content: [] }));
  await assert.rejects(a.call('reviewOrder', { symbol: 'AAPL' }), /missing required "side"/);
  await assert.rejects(a.call('reviewOrder', { symbol: 'AAPL', side: 'hold' }), /must be one of buy, sell/);
});

test('rejects a wrong-typed argument by name', async () => {
  const a = adapterWith(surface, async () => ({ content: [] }));
  await assert.rejects(
    a.call('placeOrder', { symbol: 'AAPL', side: 'buy', notional_usd: '25' }),
    /"notional_usd" should be number, got string/,
  );
});

test('rejects unknown argument when additionalProperties is false', async () => {
  const a = adapterWith(surface, async () => ({ content: [] }));
  await assert.rejects(
    a.call('reviewOrder', { symbol: 'AAPL', side: 'buy', quantity: 3 }),
    /unknown argument "quantity"/,
  );
});

test('isError becomes an exception, not a silent success', async () => {
  const a = adapterWith(fixture, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'Insufficient buying power.' }],
  }));
  await assert.rejects(a.call('reviewOrder', { symbol: 'AAPL', side: 'buy' }), ToolCallFailed);
});

test('ToolCallFailed carries the tool name and the raw result', async () => {
  const raw = { isError: true, content: [{ type: 'text', text: 'Rejected.' }] };
  const a = adapterWith(fixture, async () => raw);
  await a.call('reviewOrder', { symbol: 'AAPL', side: 'buy' }).then(
    () => assert.fail('should have thrown'),
    (err) => {
      assert.ok(err instanceof ToolCallFailed);
      assert.equal(err.tool, 'review_equity_order');
      assert.equal(err.result, raw);
      assert.match(err.message, /Rejected\./);
    },
  );
});

test('resolves reads and writes across a fuller surface', () => {
  const a = adapterWith(surface, async () => ({ content: [] }));
  assert.equal(a.resolve('listPositions').name, 'get_positions');
  assert.equal(a.resolve('listAccounts').name, 'get_accounts');
  assert.equal(a.resolve('listOrders').name, 'list_orders');
  assert.equal(a.resolve('placeOrder').name, 'place_equity_order');
  assert.equal(a.resolve('cancelOrder').name, 'cancel_order');
});

test('write classification keeps mutating tools separate from reads', () => {
  const a = adapterWith(surface, async () => ({ content: [] }));
  assert.deepEqual([...a.writeTools].sort(), ['cancel_order', 'place_equity_order']);
  assert.equal(isWrite({ name: 'get_positions' }), false);
  assert.equal(isWrite({ name: 'place_equity_order' }), true);
  // A read prefix wins even when a write verb appears later in the name.
  assert.equal(isWrite({ name: 'get_order_history' }), false);
  // Caveat worth pinning: the heuristic only flags known write verbs. A novel
  // verb with no read prefix (e.g. rebalance) is NOT caught — hence the manual
  // writeTools review and EXPLICIT_WRITES override documented in the README.
  assert.equal(isWrite({ name: 'rebalance_portfolio' }), false);
});

test('strips the local __simulated flag before it reaches the wire', async () => {
  let sent;
  const a = adapterWith(surface, async (params) => {
    sent = params;
    return { content: [] };
  });
  await a.call('reviewOrder', { symbol: 'AAPL', side: 'buy', __simulated: true });
  assert.deepEqual(sent, { name: 'review_equity_order', arguments: { symbol: 'AAPL', side: 'buy' } });
  assert.equal('__simulated' in sent.arguments, false);
});

test('routes writes through the guard and only counts successes', async () => {
  const events = [];
  const guard = {
    policy: { agentic_account_funded_usd: 500 },
    check: (intent) => events.push(['check', intent.tool, intent.notionalUsd, intent.simulated]),
    recordPlaced: (intent) => events.push(['recordPlaced', intent.tool]),
  };
  const a = adapterWith(surface, async () => ({ content: [{ type: 'text', text: 'ok' }] }), guard);

  await a.call('placeOrder', { symbol: 'AAPL', side: 'buy', notional_usd: 25, __simulated: true });
  assert.deepEqual(events, [
    ['check', 'place_equity_order', 25, true],
    ['recordPlaced', 'place_equity_order'],
  ]);
});

test('a guard rejection stops the call before it is sent', async () => {
  let called = false;
  const guard = {
    policy: { agentic_account_funded_usd: 500 },
    check: () => {
      throw new Error('policy violation [max_order_notional_usd]: 25 exceeds 10');
    },
    recordPlaced: () => assert.fail('must not record a placement that was blocked'),
  };
  const a = adapterWith(surface, async () => {
    called = true;
    return { content: [] };
  }, guard);

  await assert.rejects(
    a.call('placeOrder', { symbol: 'AAPL', side: 'buy', notional_usd: 25 }),
    /max_order_notional_usd/,
  );
  assert.equal(called, false, 'a blocked write must never reach the client');
});

test('a failed write (isError) does not consume daily budget', async () => {
  const events = [];
  const guard = {
    policy: { agentic_account_funded_usd: 500 },
    check: () => events.push('check'),
    recordPlaced: () => events.push('recordPlaced'),
  };
  const a = adapterWith(surface, async () => ({ isError: true, content: [{ type: 'text', text: 'no' }] }), guard);

  await assert.rejects(a.call('placeOrder', { symbol: 'AAPL', side: 'buy', notional_usd: 25 }), ToolCallFailed);
  assert.deepEqual(events, ['check'], 'recordPlaced must not run when the tool reports isError');
});

test('reads bypass the guard entirely', async () => {
  const guard = {
    policy: { agentic_account_funded_usd: 500 },
    check: () => assert.fail('reads must not be guarded'),
    recordPlaced: () => assert.fail('reads must not be recorded'),
  };
  const a = adapterWith(surface, async () => ({ content: [] }), guard);
  await a.call('listPositions', {});
});

test('reviewThenPlace refuses to place when review is unavailable', async () => {
  const noReview = surface.filter((t) => t.name !== 'review_equity_order');
  const a = adapterWith(noReview, async () => ({ content: [] }));
  await assert.rejects(
    a.reviewThenPlace({ symbol: 'AAPL', side: 'buy', notional_usd: 25 }),
    ToolUnavailable,
  );
});

test('textOf joins only text content blocks', () => {
  const result = {
    content: [
      { type: 'text', text: 'line one' },
      { type: 'image', data: '...' },
      { type: 'text', text: 'line two' },
    ],
  };
  assert.equal(textOf(result), 'line one\nline two');
  assert.equal(textOf({}), '');
});

test('every declared capability has a predicate', () => {
  for (const [name, predicate] of Object.entries(CAPABILITIES)) {
    assert.equal(typeof predicate, 'function', `${name} must be a predicate`);
  }
});
/* built by nirholas x.com/nichxbt */
