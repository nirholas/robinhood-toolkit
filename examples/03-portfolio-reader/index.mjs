/**
 * robinhood-toolkit · example 03: portfolio reader
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Read an address's native ETH balance plus its balance in every known token,
 * batched through Multicall3 so the whole portfolio costs one round trip
 * instead of one per token per field.
 *
 * Two things this does deliberately:
 *
 *   - Decimals are read from each contract in the SAME multicall as the
 *     balance, never assumed. Assuming 18 misreads USDG by a factor of 10^12
 *     and the wrong number still looks like a balance.
 *   - Every token is proven canonical by address before its balance is shown,
 *     so a ticker collision cannot put an impostor's balance in your portfolio
 *     under a trusted name.
 *
 * Read-only. No key, no signing, no spend.
 *
 * Usage:
 *   node index.mjs                     # a live pool address with real balances
 *   node index.mjs 0xYourAddress
 *   node index.mjs 0xYourAddress 0xExtraTokenAddress
 */

import { createPublicClient, erc20Abi, formatEther, getAddress, http, isAddress } from 'viem'
import {
  KNOWN_TOKENS,
  MULTICALL3_ADDRESS,
  USDG,
  WETH,
  formatToken,
  hasMulticall3,
  knownTokenAt,
  robinhoodChain,
  verifyToken,
} from 'robinhood-chain'

/**
 * Default subject: the WETH/USDG Uniswap v3 pool at
 * 0x8803c117ccae7B5146297876c2A25DF135141C4d. Chosen because it holds a real
 * balance of both known tokens, so the populated path is visible without the
 * reader needing a funded wallet. It is a contract, not a personal wallet.
 */
const DEFAULT_ADDRESS = '0x8803c117ccae7B5146297876c2A25DF135141C4d'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const subject = args[0] ?? DEFAULT_ADDRESS
const extraTokens = args.slice(1)

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RH_RPC || undefined) })

function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  console.error('')
  process.exit(1)
}

// strict:false accepts a lowercase or mixed-case address without demanding a
// valid EIP-55 checksum. Addresses get pasted from block explorers, logs, and
// chat messages with the casing mangled; rejecting those is user-hostile.
// getAddress() below re-checksums whatever comes in.
if (!isAddress(subject, { strict: false })) {
  fail(`"${subject}" is not a valid EVM address. Pass a 0x-prefixed 20-byte address (40 hex characters).`)
}
for (const token of extraTokens) {
  if (!isAddress(token, { strict: false })) {
    fail(`"${token}" is not a valid token address. Pass a 0x-prefixed 20-byte address (40 hex characters).`)
  }
}

const account = getAddress(subject)

// The token set: the curated constants, plus anything the reader passed on the
// command line. Deduplicated by address, which is the only identity that means
// anything on a chain with a live ticker collision.
const tokenList = [...Object.values(KNOWN_TOKENS), ...extraTokens.map((address) => ({ address: getAddress(address) }))]
const tokens = [...new Map(tokenList.map((t) => [getAddress(t.address).toLowerCase(), t])).values()]

console.log(`\n  Portfolio  ${account}`)
console.log(`  Chain      ${robinhoodChain.name} (${robinhoodChain.id})`)
console.log(`  Explorer   ${robinhoodChain.blockExplorers.default.url}/address/${account}\n`)

// viem's multicall() throws ChainDoesNotSupportContract without
// contracts.multicall3 on the chain definition. It does NOT fall back to
// individual eth_calls. robinhood-chain declares it; confirm the bytecode is
// actually deployed before relying on it.
let multicallAvailable = false
try {
  multicallAvailable = await hasMulticall3(client)
} catch (error) {
  fail('Could not reach Robinhood Chain.', error)
}

if (!multicallAvailable) {
  fail(
    `Multicall3 is not deployed at ${MULTICALL3_ADDRESS} on this endpoint. ` +
      'Point RH_RPC at a Robinhood Chain node or read balances individually.',
  )
}

let head
let nativeBalance
let results
try {
  // One multicall carries balanceOf + decimals + symbol + name for every token.
  // Decimals ride along with the balance so the two can never disagree.
  const calls = tokens.flatMap((token) => [
    { address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [account] },
    { address: token.address, abi: erc20Abi, functionName: 'decimals' },
    { address: token.address, abi: erc20Abi, functionName: 'symbol' },
    { address: token.address, abi: erc20Abi, functionName: 'name' },
  ])

  ;[head, nativeBalance, results] = await Promise.all([
    client.getBlockNumber(),
    client.getBalance({ address: account }),
    // allowFailure keeps one bad address from voiding the whole batch. A token
    // that fails to read is reported as such, never silently dropped.
    client.multicall({ contracts: calls, allowFailure: true }),
  ])
} catch (error) {
  fail('Could not read balances from Robinhood Chain.', error)
}

const holdings = []
const unreadable = []

for (const [index, token] of tokens.entries()) {
  const [balance, decimals, symbol, name] = results.slice(index * 4, index * 4 + 4)

  if (balance.status !== 'success' || decimals.status !== 'success') {
    unreadable.push({
      address: token.address,
      reason: (balance.error ?? decimals.error)?.shortMessage ?? 'not a readable ERC-20 on this chain',
    })
    continue
  }

  holdings.push({
    address: token.address,
    raw: balance.result,
    // Read at call time. Never defaulted, never inferred from the symbol.
    decimals: Number(decimals.result),
    symbol: symbol.status === 'success' ? symbol.result : null,
    name: name.status === 'success' ? name.result : null,
    known: knownTokenAt(token.address),
  })
}

// Verify each known token really is what the constant claims. A curated
// constant is only as good as the chain agreeing with it.
for (const holding of holdings) {
  if (!holding.known) {
    holding.verification = 'unverified (not in the curated set, resolve it yourself)'
    continue
  }
  const result = await verifyToken(client, holding.address, holding.known)
  holding.verification = result.ok ? 'canonical' : `NOT CANONICAL: ${result.error?.message ?? 'mismatch'}`
}

console.log(`  Block ${head.toLocaleString('en-US')}\n`)

const nonZero = holdings.filter((h) => h.raw > 0n)
const hasNative = nativeBalance > 0n

// ---------------------------------------------------------------------------
// The empty-wallet case is a first-class state, not a blank screen.
// ---------------------------------------------------------------------------

if (!hasNative && nonZero.length === 0) {
  console.log('  This address holds no ETH and no balance in any of the tokens checked.')
  console.log('')
  console.log(`  Tokens checked: ${holdings.map((h) => h.symbol ?? h.address).join(', ')}`)
  console.log('')
  console.log('  That is expected for a fresh address. To see the populated output:')
  console.log('')
  console.log('    node index.mjs                       # a live pool with real balances')
  console.log(`    node index.mjs ${account} 0xOtherToken   # check additional tokens`)
  console.log('')
  console.log('  To fund an address on TESTNET, use the faucet:')
  console.log('    https://faucet.testnet.chain.robinhood.com')
  console.log('')
  console.log('  Bridging to mainnet is a write action. This example never signs anything.')
  console.log('  Run that from your own terminal with your own key.\n')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Populated state
// ---------------------------------------------------------------------------

const rows = []
rows.push({
  asset: 'ETH',
  detail: 'native gas token',
  amount: formatEther(nativeBalance),
  note: hasNative ? '' : 'zero',
})

for (const holding of holdings) {
  rows.push({
    asset: holding.symbol ?? '?',
    detail: `${holding.address}  ${holding.decimals} decimals`,
    amount: formatToken(holding.raw, holding.decimals),
    note: holding.verification === 'canonical' ? '' : holding.verification,
  })
}

const assetWidth = Math.max(...rows.map((r) => r.asset.length), 5)
const amountWidth = Math.max(...rows.map((r) => r.amount.length), 6)

console.log(`  ${'ASSET'.padEnd(assetWidth)}  ${'BALANCE'.padStart(amountWidth)}  DETAIL`)
console.log(`  ${'-'.repeat(assetWidth)}  ${'-'.repeat(amountWidth)}  ${'-'.repeat(40)}`)

for (const row of rows) {
  console.log(`  ${row.asset.padEnd(assetWidth)}  ${row.amount.padStart(amountWidth)}  ${row.detail}`)
  if (row.note) console.log(`  ${' '.repeat(assetWidth)}  ${' '.repeat(amountWidth)}  ${row.note}`)
}

if (unreadable.length > 0) {
  console.log('\n  Could not read:')
  for (const token of unreadable) console.log(`    ${token.address}  ${token.reason}`)
}

console.log(`\n  ${1 + tokens.length * 4} reads in 2 round trips (1 eth_getBalance + 1 Multicall3 aggregate).`)
console.log('  Decimals came from the contracts, not from a constant:')
console.log(`    ${WETH.symbol} ${holdings.find((h) => h.address === WETH.address)?.decimals ?? '?'}, ` +
  `${USDG.symbol} ${holdings.find((h) => h.address === USDG.address)?.decimals ?? '?'} ` +
  `(assuming 18 for USDG understates it by 10^12)\n`)
