/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · discover Morpho markets and vaults on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Market IDs are not looked up, they are computed: id = keccak256(abi.encode(
 * marketParams)). Recomputing every discovered market's id and checking it
 * against the CreateMarket log is the proof that the struct field order is right.
 * If it were wrong, every downstream supply()/withdraw() would hit the wrong
 * market or revert.
 */
import { encodeAbiParameters, getAddress, keccak256, parseAbiItem } from 'viem'
import { scanLogs } from 'robinhood-chain'
import { morphoAbi } from './verify.mjs'

// Field order is load-bearing and must match Morpho Blue's MarketParams exactly.
const MARKET_PARAMS_TYPE = [
  {
    type: 'tuple',
    components: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ],
  },
]

export function marketId(params) {
  return keccak256(encodeAbiParameters(MARKET_PARAMS_TYPE, [params]))
}

const createMarketEvent = parseAbiItem(
  'event CreateMarket(bytes32 indexed id, (address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams)',
)

/**
 * Scan CreateMarket logs using the chain SDK's adaptive scanner (prompt 10). At
 * ~101 ms blocks the range is enormous, so `fromBlock` should be the block
 * Morpho was deployed at, which you can read off Blockscout — never 0 in
 * production. The scanner halves its chunk on any RPC cap and resumes.
 *
 * CreateMarket is a SPARSE event — a couple dozen logs across all of history —
 * so the matched-log cap that forces a 1000-block chunk for Transfer scans never
 * bites here. A very wide chunk turns a multi-million-block history into a few
 * dozen requests. The scanner still halves on any error, so an over-wide default
 * costs nothing but a retry in the worst case.
 */
export async function discoverMarkets(client, morphoBlue, { fromBlock = 0n, toBlock, chunkSize = 1_000_000n, onProgress } = {}) {
  const head = toBlock ?? (await client.getBlockNumber())
  const { logs, stats } = await scanLogs({
    client,
    address: morphoBlue,
    event: createMarketEvent,
    fromBlock,
    toBlock: head,
    chunkSize,
    onChunk: onProgress,
  })
  const markets = logs.map((log) => ({
    id: log.args.id,
    params: log.args.marketParams,
    block: log.blockNumber,
  }))
  return { markets, stats }
}

/**
 * Prove every discovered market's id recomputes from its params. A mismatch
 * means the MarketParams encoding above is wrong. Returns the offenders; an
 * empty array is what correct encoding looks like.
 */
export function findMismatchedIds(markets) {
  return markets.filter((m) => marketId(m.params).toLowerCase() !== m.id.toLowerCase())
}

/**
 * Filter to markets where a given token is the loan asset, read each market's
 * live state, and sort by total supplied. These are the markets you can supply
 * that token into.
 */
export async function loanMarkets(client, morphoBlue, loanToken, markets) {
  const target = getAddress(loanToken)
  const matching = markets.filter((m) => getAddress(m.params.loanToken) === target)

  const withState = []
  for (const m of matching) {
    const state = await readMarketState(client, morphoBlue, m.id)
    withState.push({ ...m, ...state })
  }
  return withState.sort((a, b) => (b.totalSupplyAssets > a.totalSupplyAssets ? 1 : -1))
}

/** Named alias kept for the USDG-specific path the toolkit cares about. */
export const usdgMarkets = loanMarkets

// Morpho's SharesMathLib virtual amounts. Supply shares convert to assets as
// shares * (totalSupplyAssets + VIRTUAL_ASSETS) / (totalSupplyShares + VIRTUAL_SHARES),
// rounded down. These constants are part of the protocol, not a tunable.
const VIRTUAL_SHARES = 1_000_000n
const VIRTUAL_ASSETS = 1n

/**
 * The USDG a supplier's position is currently worth in a market. Reads
 * position() and market(); call Morpho.accrueInterest(params) first if you need
 * the value to include interest since the market's lastUpdate.
 */
export async function supplyAssetsOf(client, morphoBlue, id, account) {
  const [pos, state] = await Promise.all([
    client.readContract({ address: morphoBlue, abi: morphoAbi, functionName: 'position', args: [id, account] }),
    readMarketState(client, morphoBlue, id),
  ])
  const supplyShares = pos[0]
  return {
    supplyShares,
    assets: (supplyShares * (state.totalSupplyAssets + VIRTUAL_ASSETS)) / (state.totalSupplyShares + VIRTUAL_SHARES),
  }
}

/** Read one market's live accounting and derive utilization. */
export async function readMarketState(client, morphoBlue, id) {
  const state = await client.readContract({
    address: morphoBlue,
    abi: morphoAbi,
    functionName: 'market',
    args: [id],
  })
  const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = state
  return {
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares,
    lastUpdate,
    fee,
    utilization:
      totalSupplyAssets === 0n ? 0 : Number((totalBorrowAssets * 10_000n) / totalSupplyAssets) / 10_000,
  }
}
/* built by nirholas x.com/nichxbt */
