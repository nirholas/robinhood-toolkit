/**
 * robinhood-toolkit · portfolio CLI over the read layer
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Print a full portfolio — native ETH plus every known token balance — for any
 * address, batched through Multicall3 in two round trips regardless of token
 * count. Read-only: no key, no signing, no spend.
 *
 * Usage:
 *   node scripts/portfolio.mjs                     # WETH contract, a real address with balances
 *   node scripts/portfolio.mjs 0xYourAddress
 *   node scripts/portfolio.mjs 0xYourAddress 0xExtraToken
 *   node scripts/portfolio.mjs --fallback 0xAddr   # force the sequential fallback (bogus multicall addr)
 *
 * Env:
 *   RH_RPC   override the mainnet RPC URL
 */

import { createPublicClient, defineChain, http, isAddress } from 'viem'
import { KNOWN_TOKENS, USDG, WETH, hasMulticall3, readPortfolio, robinhoodChain } from 'robinhood-chain'

const raw = process.argv.slice(2)
const forceFallback = raw.includes('--fallback')
const args = raw.filter((a) => !a.startsWith('--'))

// Default subject is the WETH contract's own address: a real address that
// returns a real result without needing a funded wallet. A convenient smoke test.
const DEFAULT_ADDRESS = WETH.address
const subject = args[0] ?? DEFAULT_ADDRESS
const extraTokens = args.slice(1)

function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  console.error('')
  process.exit(1)
}

if (!isAddress(subject, { strict: false })) {
  fail(`"${subject}" is not a valid EVM address. Pass a 0x-prefixed 20-byte address.`)
}
for (const token of extraTokens) {
  if (!isAddress(token, { strict: false })) fail(`"${token}" is not a valid token address.`)
}

// --fallback exercises the sequential path. viem's multicall() throws
// ChainDoesNotSupportContract ONLY when the chain definition has no
// contracts.multicall3 AND no address is passed — a bogus address does not
// throw, it returns per-call failures. So the honest way to force the fallback
// is a chain stripped of multicall3, read with multicallAddress: null. A
// fallback you never ran is a fallback that does not work.
const strippedChain = defineChain({ ...robinhoodChain, contracts: {} })
const client = createPublicClient({
  chain: forceFallback ? strippedChain : robinhoodChain,
  transport: http(process.env.RH_RPC || undefined),
})

// The token set: curated constants plus anything passed on the command line.
const tokenAddresses = [...Object.values(KNOWN_TOKENS).map((t) => t.address), ...extraTokens]

console.log(`\n  Portfolio  ${subject}`)
console.log(`  Chain      ${robinhoodChain.name} (${robinhoodChain.id})`)
if (forceFallback) console.log('  Mode       --fallback: routing reads through the sequential path\n')
else console.log('')

if (!forceFallback) {
  let ok = false
  try {
    ok = await hasMulticall3(client)
  } catch (error) {
    fail('Could not reach Robinhood Chain.', error)
  }
  if (!ok) {
    console.warn('  Multicall3 bytecode not found; readPortfolio will fall back to sequential reads.\n')
  }
}

let portfolio
try {
  portfolio = await readPortfolio(client, subject, tokenAddresses, {
    multicallAddress: forceFallback ? null : undefined,
  })
} catch (error) {
  fail('Could not read the portfolio.', error)
}

// --- render ---------------------------------------------------------------

const rows = [{ asset: 'ETH', amount: portfolio.nativeEth, detail: 'native gas token' }]
for (const t of portfolio.tokens) {
  if (t.error) {
    rows.push({ asset: t.symbol ?? '?', amount: '-', detail: `${t.address}  (${t.error})` })
    continue
  }
  rows.push({
    asset: t.symbol,
    amount: t.formatted,
    detail: `${t.address}  ${t.decimals} decimals${t.known ? '' : '  (not in curated set)'}`,
  })
}

const assetW = Math.max(...rows.map((r) => r.asset.length), 5)
const amountW = Math.max(...rows.map((r) => r.amount.length), 7)

console.log(`  ${'ASSET'.padEnd(assetW)}  ${'BALANCE'.padStart(amountW)}  DETAIL`)
console.log(`  ${'-'.repeat(assetW)}  ${'-'.repeat(amountW)}  ${'-'.repeat(48)}`)
for (const r of rows) {
  console.log(`  ${r.asset.padEnd(assetW)}  ${r.amount.padStart(amountW)}  ${r.detail}`)
}

// Prove decimals came from the contracts, not a constant. USDG must read 6.
const usdgRow = portfolio.tokens.find((t) => t.address.toLowerCase() === USDG.address.toLowerCase())
const wethRow = portfolio.tokens.find((t) => t.address.toLowerCase() === WETH.address.toLowerCase())
console.log('')
console.log(`  decimals read on-chain:  WETH ${wethRow?.decimals ?? '?'}, USDG ${usdgRow?.decimals ?? '?'}`)
console.log('  (assuming 18 for USDG would understate it by a factor of 10^12)')
console.log(`\n  ${portfolio.explorer}\n`)
