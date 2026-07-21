/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · public client factory with transport failover
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPublicClient, fallback, http } from 'viem';
import { robinhoodMainnet } from './chains.js';

/**
 * Build the failover transport for a chain. Keyed provider first when
 * ALCHEMY_API_KEY is set (mainnet only — a testnet Alchemy host is UNVERIFIED,
 * do not derive one by string substitution), public RPC as the backstop.
 *
 * `fallback` gives automatic failover on transport error, which a bare `http()`
 * does not. Ranking is off: `rank: true` sends background latency probes and
 * adds load — leave it off until you have measured a reason to enable it.
 *
 * Never hardcode a key. An unset key simply drops that rung of the chain.
 */
export function transportFor(chain = robinhoodMainnet) {
  const urls = [];

  const key = process.env.ALCHEMY_API_KEY;
  if (key && chain.id === robinhoodMainnet.id) {
    urls.push(`https://robinhood-mainnet.g.alchemy.com/v2/${key}`);
  }
  urls.push(chain.rpcUrls.default.http[0]);

  return fallback(
    urls.map((url) =>
      http(url, {
        // At ~101 ms blocks, one-request-per-block-per-field hits the rate
        // limit fast. Batching collapses those into single calls.
        batch: { wait: 16 },
        retryCount: 3,
        retryDelay: 150,
        timeout: 10_000,
      }),
    ),
    { rank: false },
  );
}

/** Read-only client for a chain, wired to the failover transport above. */
export function publicClientFor(chain = robinhoodMainnet) {
  return createPublicClient({ chain, transport: transportFor(chain) });
}
/* built by nirholas x.com/nichxbt */
