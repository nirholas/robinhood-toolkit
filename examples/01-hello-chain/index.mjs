/**
 * robinhood-toolkit · example 01: hello chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * The 30-second "it works" example. Opens a read-only viem client against
 * Robinhood Chain mainnet and prints four facts that prove the connection is
 * live: the chain ID the node reports, the current head block, the current gas
 * price, and the node's client version string.
 *
 * Read-only. No key, no signing, no spend.
 *
 * Usage:
 *   node index.mjs                 # mainnet (4663)
 *   node index.mjs --testnet       # testnet (46630)
 *   RH_RPC=https://your.endpoint node index.mjs
 */

import { createPublicClient, formatGwei, formatEther, http } from 'viem'
import {
  BLOCK_TIME_MS,
  MULTICALL3_ADDRESS,
  hasMulticall3,
  robinhoodChain,
  robinhoodTestnet,
} from 'robinhood-chain'

const useTestnet = process.argv.includes('--testnet')
const chain = useTestnet ? robinhoodTestnet : robinhoodChain

// The chain definition carries its own RPC URL, so bare http() works. Override
// with RH_RPC to point at a keyed provider.
const rpcUrl = process.env.RH_RPC || chain.rpcUrls.default.http[0]

const client = createPublicClient({ chain, transport: http(process.env.RH_RPC || undefined) })

/** Exit non-zero with a message a reader can act on, never a bare stack trace. */
function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  console.error(`\n  Endpoint: ${rpcUrl}`)
  console.error('  Check the endpoint is reachable and that you are not being rate limited.\n')
  process.exit(1)
}

function row(label, value) {
  console.log(`  ${label.padEnd(16)}${value}`)
}

console.log(`\n  ${chain.name}\n`)

let chainId
let head
let block
let gasPrice
let clientVersion

try {
  // getChainId asks the node rather than trusting the local chain definition.
  // A mismatch means the endpoint is not the network you think it is.
  ;[chainId, head, gasPrice] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getGasPrice(),
  ])

  // web3_clientVersion is outside viem's typed action surface, so it goes
  // through the raw request channel.
  ;[block, clientVersion] = await Promise.all([
    client.getBlock({ blockNumber: head }),
    client.request({ method: 'web3_clientVersion' }),
  ])
} catch (error) {
  fail('Could not reach Robinhood Chain.', error)
}

if (chainId !== chain.id) {
  fail(`Endpoint reported chain ID ${chainId}, expected ${chain.id}. This is not the network it claims to be.`)
}

row('Chain ID', `${chainId}  (0x${chainId.toString(16)})`)
row('Head block', head.toLocaleString('en-US'))
row('Block time', new Date(Number(block.timestamp) * 1000).toISOString())
row('Gas price', `${formatGwei(gasPrice)} gwei`)
row('Client', clientVersion)
row('Explorer', chain.blockExplorers.default.url)
row('RPC', rpcUrl)

// A 21,000-gas transfer is the cheapest possible transaction, so it is the
// clearest single number for "what does this chain cost".
const transferCost = gasPrice * 21_000n
row('Transfer cost', `${formatEther(transferCost)} ETH  (21,000 gas)`)

// viem's multicall() throws outright without contracts.multicall3 on the chain
// definition. robinhood-chain declares it; this confirms the bytecode is really
// there rather than trusting the declaration.
const multicall = await hasMulticall3(client).catch(() => false)
row('Multicall3', multicall ? `deployed at ${MULTICALL3_ADDRESS}` : 'NOT FOUND at the canonical address')

// Block-count intuition from a 12-second L1 is off by two orders of magnitude
// here, so state the cadence in terms a reader can hold onto.
const blocksPerDay = Math.round((24 * 60 * 60 * 1000) / BLOCK_TIME_MS)
console.log(
  `\n  At approximately ${BLOCK_TIME_MS} ms per block that is about ` +
    `${blocksPerDay.toLocaleString('en-US')} blocks per day.\n`,
)
