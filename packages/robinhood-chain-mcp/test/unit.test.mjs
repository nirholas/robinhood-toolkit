/**
 * robinhood-toolkit · robinhood-chain-mcp unit tests (no network)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { strict as assert } from 'node:assert';
import test, { describe } from 'node:test';

import { NETWORKS, chainFor, explorerUrl, robinhoodMainnet, robinhoodTestnet, MULTICALL3 } from '../src/chain.mjs';
import { ToolError, describeError, fail, ok, requireAddress, requireTxHash } from '../src/errors.mjs';
import { KNOWN_TOKENS, knownTokenByAddress, knownTokenBySymbol } from '../src/erc20.mjs';
import { ROBINHOOD_SLUG, deepestPool, normalisePair } from '../src/dexscreener.mjs';

describe('chain definitions', () => {
  test('network constants match the live chain', () => {
    assert.equal(robinhoodMainnet.id, 4663);
    assert.equal(robinhoodTestnet.id, 46630);
    assert.equal(robinhoodMainnet.rpcUrls.default.http[0], 'https://rpc.mainnet.chain.robinhood.com');
    assert.equal(robinhoodTestnet.rpcUrls.default.http[0], 'https://rpc.testnet.chain.robinhood.com');
    assert.equal(robinhoodMainnet.blockExplorers.default.url, 'https://robinhoodchain.blockscout.com');
    assert.equal(robinhoodMainnet.nativeCurrency.symbol, 'ETH');
  });

  test('multicall3 is declared on both chains, which viem requires', () => {
    // viem throws ChainDoesNotSupportContract rather than degrading to single
    // calls, so a missing entry here breaks every batched read.
    assert.equal(robinhoodMainnet.contracts.multicall3.address, MULTICALL3);
    assert.equal(robinhoodTestnet.contracts.multicall3.address, MULTICALL3);
  });

  test('chainFor resolves both slugs and rejects anything else', () => {
    assert.deepEqual([...NETWORKS], ['mainnet', 'testnet']);
    assert.equal(chainFor('mainnet').id, 4663);
    assert.equal(chainFor('testnet').id, 46630);
    assert.equal(chainFor().id, 4663, 'defaults to mainnet');
    assert.throws(() => chainFor('ethereum'), /unknown network/);
  });

  test('explorer links point at the right host per network', () => {
    assert.equal(
      explorerUrl('mainnet', 'token', '0xabc'),
      'https://robinhoodchain.blockscout.com/token/0xabc',
    );
    assert.equal(
      explorerUrl('testnet', 'tx', '0xdef'),
      'https://explorer.testnet.chain.robinhood.com/tx/0xdef',
    );
  });
});

describe('boundary validation', () => {
  test('requireAddress checksums valid input', () => {
    assert.equal(
      requireAddress('0x5fc5360d0400a0fd4f2af552add042d716f1d168'),
      '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    );
  });

  test('requireAddress rejects malformed input with an actionable message', () => {
    for (const bad of ['not-an-address', '0x123', '', null, undefined, 42, '0xZZZZ']) {
      assert.throws(
        () => requireAddress(bad, 'token'),
        (error) => {
          assert.ok(error instanceof ToolError);
          assert.match(error.message, /"token" is not a valid EVM address/);
          assert.match(error.hint, /0x-prefixed 20-byte hex/);
          return true;
        },
        `expected ${JSON.stringify(bad)} to be rejected`,
      );
    }
  });

  test('requireTxHash accepts a 32-byte hash and rejects short ones', () => {
    const hash = `0x${'a'.repeat(64)}`;
    assert.equal(requireTxHash(hash), hash);
    assert.throws(() => requireTxHash(`0x${'a'.repeat(63)}`), /not a valid transaction hash/);
    assert.throws(() => requireTxHash('0xdeadbeef'), /not a valid transaction hash/);
  });
});

describe('result envelopes', () => {
  test('ok serialises BigInt without throwing or losing precision', () => {
    // JSON.stringify throws on BigInt by default, and Number() would corrupt a
    // uint256. Decimal strings are the only safe representation.
    const huge = 2n ** 255n;
    const result = ok({ raw: huge });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).raw, huge.toString());
  });

  test('fail marks isError and appends the hint', () => {
    const result = fail('something broke', { hint: 'try this instead' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /something broke/);
    assert.match(result.content[0].text, /Hint: try this instead/);
  });

  test('describeError classifies transport failures into readable sentences', () => {
    assert.match(describeError(new Error('fetch failed')).message, /Could not reach the Robinhood Chain RPC/);
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    assert.match(describeError(abort).message, /timed out/);
    const tool = new ToolError('deliberate', { hint: 'h' });
    assert.deepEqual(describeError(tool), { message: 'deliberate', hint: 'h' });
  });
});

describe('canonical token list', () => {
  test('USDG is recorded with six decimals, not eighteen', () => {
    // The single most consequential constant in this package: an 18 here would
    // misreport every USDG balance by a factor of a trillion.
    const usdg = knownTokenBySymbol('mainnet', 'usdg');
    assert.equal(usdg.decimals, 6);
    assert.equal(usdg.name, 'Global Dollar');
    assert.equal(usdg.address, '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
  });

  test('WETH is recorded with eighteen decimals', () => {
    const weth = knownTokenBySymbol('mainnet', 'WETH');
    assert.equal(weth.decimals, 18);
    assert.equal(weth.address, '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73');
  });

  test('the impostor USDG is NOT in the canonical list', () => {
    assert.equal(knownTokenByAddress('mainnet', '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'), null);
  });

  test('lookups are case-insensitive and miss cleanly', () => {
    assert.equal(knownTokenBySymbol('mainnet', 'nosuchticker'), null);
    assert.ok(knownTokenByAddress('mainnet', '0x5fc5360d0400a0fd4f2af552add042d716f1d168'));
  });

  test('no Stock Token addresses are hardcoded', () => {
    // Stock Tokens live in a dynamic registry and must resolve at runtime.
    // This list is only the two hand-verified infrastructure contracts.
    assert.equal(KNOWN_TOKENS.mainnet.length, 2);
    assert.deepEqual(
      KNOWN_TOKENS.mainnet.map((token) => token.symbol).sort(),
      ['USDG', 'WETH'],
    );
  });
});

describe('dexscreener normalisation', () => {
  test('the chain slug is the string "robinhood", not the numeric id', () => {
    // Passing 4663 returns HTTP 200 with an empty body, so this fails silently.
    assert.equal(ROBINHOOD_SLUG, 'robinhood');
  });

  test('normalisePair coerces string prices to numbers', () => {
    const pair = normalisePair({
      chainId: 'robinhood',
      pairAddress: '0xpool',
      priceUsd: '1.00067',
      liquidity: { usd: 15763.21 },
      volume: { h24: 55313.74 },
      pairCreatedAt: 1_700_000_000_000,
    });
    assert.equal(pair.priceUsd, 1.00067);
    assert.equal(typeof pair.priceUsd, 'number');
    assert.equal(pair.liquidityUsd, 15763.21);
    assert.equal(pair.createdAt, new Date(1_700_000_000_000).toISOString());
  });

  test('normalisePair yields null rather than NaN for a brand-new pool', () => {
    const pair = normalisePair({ chainId: 'robinhood', pairAddress: '0xnew' });
    assert.equal(pair.priceUsd, null);
    assert.equal(pair.fdv, null);
    assert.equal(pair.marketCap, null);
    assert.equal(pair.createdAt, null);
  });

  test('deepestPool picks by liquidity, never by array position', () => {
    const pools = [
      { pairAddress: '0xshallow', liquidityUsd: 100 },
      { pairAddress: '0xdeep', liquidityUsd: 900_000 },
      { pairAddress: '0xbroken', liquidityUsd: null },
    ];
    assert.equal(deepestPool(pools).pairAddress, '0xdeep');
    assert.equal(deepestPool([]), null);
  });

  // This asserts a FAILURE, on purpose. Liquidity is purchasable, so it ranks
  // impostors above real tokens whenever someone funds the pool. These are the
  // deepest-pool figures measured on Robinhood Chain 2026-07-20: the impostor
  // USDG outweighs the canonical Global Dollar by 30x. Resolving a symbol by depth picks
  // the wrong token, and picks it more confidently the deeper the pool gets.
  // Documented as an executable fact so nobody reaches for deepestPool to
  // answer "which token is USDG?".
  test('deepestPool must NOT be used to resolve a symbol to a token', () => {
    const canonicalUsdg = {
      pairAddress: '0xcanonical',
      baseTokenAddress: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
      liquidityUsd: 3_628_928,
    };
    const impostorUsdg = {
      pairAddress: '0ximpostor',
      baseTokenAddress: '0x63575aA902DE35ef2dc3a3D32355233bbb44CDa7',
      liquidityUsd: 108_970_164,
    };

    const winner = deepestPool([canonicalUsdg, impostorUsdg]);
    assert.equal(
      winner.pairAddress,
      '0ximpostor',
      'depth-ranking selects the impostor: resolve the address first, then rank pools',
    );
    assert.notEqual(winner.baseTokenAddress, canonicalUsdg.baseTokenAddress);
  });
});
