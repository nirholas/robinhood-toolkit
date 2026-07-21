/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · example 09: read a Chainlink price feed with staleness guards
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Resolve a feed for Robinhood Chain from Chainlink's directory (or a pinned env
 * override), read it with viem, and refuse a stale or nonsensical answer.
 *
 *   node index.mjs                 # ETH_USD
 *   node index.mjs BTC_USD         # any pair name from oracle/FEEDS.md
 *   node index.mjs "NVDA_USD"      # a Robinhood Stock Token equity feed
 *
 * Prove the guard is live, not decorative:
 *   node index.mjs ETH_USD --max-age 1     # forces StalePriceError
 */
import { createPublicClient, http } from 'viem'
import { robinhoodChain } from 'robinhood-chain'
import { readPrice, StalePriceError } from './oracle/read.mjs'

const args = process.argv.slice(2)
const pair = (args.find((a) => !a.startsWith('--')) ?? 'ETH_USD').toUpperCase()
const maxAgeFlag = args.indexOf('--max-age')
const maxAgeSeconds = maxAgeFlag !== -1 ? Number(args[maxAgeFlag + 1]) : undefined

const client = createPublicClient({ chain: robinhoodChain, transport: http() })

try {
  const result = await readPrice(client, pair, { maxAgeSeconds })
  console.log(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
  console.log(`\n${result.description}: ${result.price}  (${result.ageSeconds}s old, via ${result.source})`)
} catch (err) {
  if (err instanceof StalePriceError) {
    console.error(`StalePriceError (guard working as designed): ${err.message}`)
    process.exit(2)
  }
  console.error(err.message)
  process.exit(1)
}
