/* built by nirholas x.com/nichxbt */
/**
 * robinhood-chain · public entry point
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * The chain SDK for Robinhood Chain (Arbitrum Orbit, mainnet 4663 / testnet
 * 46630). Every constant here was read from the live chain, and every helper
 * exists because of a trap that is expensive to rediscover:
 *
 *   - viem's multicall() throws without contracts.multicall3 on the chain def.
 *     It does not fall back. Both chain definitions here declare it.
 *   - USDG has 6 decimals, not 18. Nothing in this package defaults to 18.
 *   - Two live tokens on mainnet answer to the symbol "USDG". Verify by address.
 *   - eth_getLogs on mainnet has two independent caps, one of which reports
 *     itself as a parameter error. The scanner adapts to both.
 */

export {
  CHAINS,
  MULTICALL3_ADDRESS,
  ROBINHOOD_MAINNET_ID,
  ROBINHOOD_TESTNET_ID,
  addChainParams,
  chainsById,
  getChain,
  hasMulticall3,
  isRobinhoodChain,
  robinhoodChain,
  robinhoodTestnet,
} from './src/chains.js'

export { KNOWN_IMPOSTORS, KNOWN_TOKENS, USDG, WETH, isKnownImpostor, knownTokenAt } from './src/tokens.js'

export { assertDecimals, formatToken, parseToken, readBalance, readDecimals } from './src/format.js'

export { assertCanonicalToken, readTokenMetadata, verifyToken } from './src/verify.js'

export { batchRead, readPortfolio } from './src/portfolio.js'

export { DEFAULT_POLLING_INTERVAL_MS, watchHead } from './src/watch.js'

export { BlockscoutClient, ExplorerError, blockscoutFor } from './src/explorer.js'

export {
  BLOCK_TIME_MS,
  DEFAULT_CHUNK,
  MIN_CHUNK,
  blocksToMs,
  classifyScanError,
  createCursor,
  deserializeCursor,
  scanLogs,
  serializeCursor,
  streamLogs,
} from './src/logs.js'

export {
  LogScanError,
  MissingDecimalsError,
  NotCanonicalTokenError,
  RobinhoodChainError,
  UnsupportedChainError,
} from './src/errors.js'
/* built by nirholas x.com/nichxbt */
