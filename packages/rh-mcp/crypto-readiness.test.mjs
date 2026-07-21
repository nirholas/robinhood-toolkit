/**
 * robinhood-toolkit · fixture tests proving the MCP crypto lane works on rollout
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { RobinhoodMCPAdapter } from './adapter.mjs';
import { assessCryptoReadiness } from './crypto-readiness.mjs';
import { mapToSchema } from './route.mjs';

// The fixture deliberately uses `pair` and `order_type` rather than `symbol` and
// `type`. If the code only passes with the names we expected, it is not ready for
// a rollout whose naming we do not control.
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

test('reports crypto unavailable for an equities-only surface', () => {
  const equitiesOnly = [
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
  const adapter = new RobinhoodMCPAdapter({ client: { callTool: async () => ({}), close: async () => {} }, tools: equitiesOnly });
  const assessment = assessCryptoReadiness(adapter);
  assert.equal(assessment.available, false);
  assert.deepEqual(assessment.tools, []);
});
