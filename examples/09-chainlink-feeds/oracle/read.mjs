/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Chainlink feed reader with staleness guards
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * latestRoundData returning successfully is not the same as the answer being
 * fresh. Unguarded consumption of a stale oracle is one of the most common
 * causes of real DeFi losses, so readPrice fails closed on four independent
 * conditions: non-positive answer, incomplete round, answer from a previous
 * round, and age beyond the feed's heartbeat plus a grace margin.
 */
import { formatUnits, parseAbi } from 'viem'
import { resolveFeed } from './resolve.mjs'

export const aggregatorV3Abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
  'function version() view returns (uint256)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function aggregator() view returns (address)',
])

export class StalePriceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StalePriceError'
  }
}

/**
 * Read a feed's self-description straight from the proxy and confirm it has
 * bytecode on this chain. A description that names a different pair means the
 * resolved address is wrong.
 */
export async function describeFeed(client, address) {
  const [decimals, description, version, code] = await Promise.all([
    client.readContract({ address, abi: aggregatorV3Abi, functionName: 'decimals' }),
    client.readContract({ address, abi: aggregatorV3Abi, functionName: 'description' }),
    client.readContract({ address, abi: aggregatorV3Abi, functionName: 'version' }),
    client.getCode({ address }),
  ])
  if (!code || code === '0x') throw new Error(`feed ${address} has no bytecode on this chain`)
  return { address, decimals, description, version: version.toString() }
}

/**
 * Read a price and refuse to return one that is stale, non-positive, or from an
 * incomplete round. `graceSeconds` absorbs normal jitter around the heartbeat;
 * `maxAgeSeconds` overrides the resolved heartbeat when you want a tighter bound.
 */
export async function readPrice(client, pair, { graceSeconds = 300, maxAgeSeconds } = {}) {
  const feed = await resolveFeed(pair)
  const heartbeat = maxAgeSeconds ?? feed.heartbeat
  if (!Number.isFinite(heartbeat) || heartbeat <= 0) {
    throw new Error(`no heartbeat resolved for ${pair}; set CHAINLINK_HEARTBEAT_${pair.toUpperCase()} or use maxAgeSeconds`)
  }
  const meta = await describeFeed(client, feed.address)

  const [roundId, answer, startedAt, updatedAt, answeredInRound] = await client.readContract({
    address: feed.address,
    abi: aggregatorV3Abi,
    functionName: 'latestRoundData',
  })

  if (answer <= 0n) throw new StalePriceError(`${pair} answer is not positive: ${answer}`)
  if (updatedAt === 0n) throw new StalePriceError(`${pair} round ${roundId} is incomplete`)
  if (answeredInRound < roundId) throw new StalePriceError(`${pair} answer is from a previous round`)

  // Wall clock against the feed's own timestamp. Do not derive age from block
  // numbers: blocks are around 101 ms here and that ratio is not stable.
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
  const age = nowSeconds - updatedAt
  if (age > BigInt(Math.floor(heartbeat) + graceSeconds)) {
    throw new StalePriceError(`${pair} is stale: ${age}s old, heartbeat ${heartbeat}s`)
  }

  return {
    pair,
    feed: feed.address,
    source: feed.source,
    description: meta.description,
    decimals: meta.decimals,
    answer,
    price: Number(formatUnits(answer, meta.decimals)),
    roundId: roundId.toString(),
    startedAt: Number(startedAt),
    updatedAt: Number(updatedAt),
    ageSeconds: Number(age),
  }
}
