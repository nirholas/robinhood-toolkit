/**
 * robinhood-toolkit · example 02: the USDG ticker collision, end to end
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Ticker symbols are attacker-chosen strings with no uniqueness guarantee at
 * any layer of this stack. So are token names. This program proves it against
 * the live chain rather than asserting it:
 *
 *   1. Search DexScreener for the ticker "USDG" the way a resolver would.
 *   2. Show how many DISTINCT contracts on Robinhood Chain answer to it.
 *   3. Read every one of them on-chain: name, symbol, decimals, supply.
 *   4. Format one identical raw amount with each token's real decimals and
 *      watch the meaning diverge by a factor of a trillion.
 *   5. Run assertCanonicalToken against each and show that exactly one passes.
 *
 * The punchline is step 3. Multiple impostors also self-report the NAME
 * "Global Dollar", so a name check and a symbol check are both worthless.
 * Address comparison is the only authoritative test, because the address is
 * the one field an attacker cannot choose.
 *
 * Read-only. No key, no signing, no spend.
 *
 * Usage:
 *   node index.mjs
 *   node index.mjs --ticker USDG
 */

import { createPublicClient, erc20Abi, getAddress, http } from 'viem'
import {
  NotCanonicalTokenError,
  USDG,
  formatToken,
  isKnownImpostor,
  readTokenMetadata,
  robinhoodChain,
  verifyToken,
} from 'robinhood-chain'

const DEXSCREENER_SEARCH = 'https://api.dexscreener.com/latest/dex/search'

// DexScreener keys Robinhood Chain by the STRING slug "robinhood", not by the
// numeric chain ID 4663. Passing 4663 returns nothing, silently.
const DEXSCREENER_CHAIN_SLUG = 'robinhood'

const tickerIndex = process.argv.indexOf('--ticker')
const TICKER = (tickerIndex !== -1 && process.argv[tickerIndex + 1]) || 'USDG'

// The two headline addresses, confirmed on-chain. Everything else in this
// program is discovered live at runtime.
const REAL = USDG.address
const IMPOSTOR = '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4'

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RH_RPC || undefined) })

function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  console.error('')
  process.exit(1)
}

function heading(text) {
  console.log(`\n  ${text}`)
  console.log(`  ${'-'.repeat(text.length)}`)
}

// ---------------------------------------------------------------------------
// Step 1: resolve the ticker the way a naive integration would
// ---------------------------------------------------------------------------

heading(`Step 1: search DexScreener for the ticker "${TICKER}"`)

let payload
try {
  const response = await fetch(`${DEXSCREENER_SEARCH}?q=${encodeURIComponent(TICKER)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) fail(`DexScreener returned HTTP ${response.status} ${response.statusText}.`)
  payload = await response.json()
} catch (error) {
  fail('Could not reach the DexScreener search API. Check your network connection.', error)
}

const pairs = Array.isArray(payload?.pairs) ? payload.pairs : []
const onThisChain = pairs.filter((pair) => pair.chainId === DEXSCREENER_CHAIN_SLUG)

// Collect every DISTINCT contract address whose symbol matches the ticker.
// Keyed by lowercased address, because the address is the only identity that
// means anything here.
const candidates = new Map()
for (const pair of onThisChain) {
  for (const side of [pair.baseToken, pair.quoteToken]) {
    if (!side?.address) continue
    if (String(side.symbol).toUpperCase() !== TICKER.toUpperCase()) continue
    const key = side.address.toLowerCase()
    const existing = candidates.get(key)
    if (existing) {
      existing.pairs += 1
      existing.liquidityUsd += Number(pair.liquidity?.usd ?? 0)
      continue
    }
    candidates.set(key, {
      address: getAddress(side.address),
      claimedName: side.name,
      pairs: 1,
      liquidityUsd: Number(pair.liquidity?.usd ?? 0),
    })
  }
}

console.log(`  ${pairs.length} pairs returned across all chains`)
console.log(`  ${onThisChain.length} of them are on Robinhood Chain (slug "${DEXSCREENER_CHAIN_SLUG}")`)

if (candidates.size === 0) {
  fail(
    `No token with symbol "${TICKER}" is currently indexed on Robinhood Chain. ` +
      'Live market data moves. Try --ticker USDG, the collision this example documents.',
  )
}

console.log(
  `\n  ${candidates.size} DISTINCT contract${candidates.size === 1 ? '' : 's'} on this chain ` +
    `answer${candidates.size === 1 ? 's' : ''} to the ticker "${TICKER}".`,
)

if (candidates.size > 1) {
  console.log('  A resolver that takes the first search hit picks one of them at random.')
}

// ---------------------------------------------------------------------------
// Step 2: read every candidate on-chain
// ---------------------------------------------------------------------------

heading('Step 2: read each candidate on-chain')

const observed = []
for (const candidate of candidates.values()) {
  try {
    const metadata = await readTokenMetadata(client, candidate.address)
    const totalSupply = await client.readContract({
      address: candidate.address,
      abi: erc20Abi,
      functionName: 'totalSupply',
    })
    observed.push({ ...candidate, ...metadata, totalSupply })
  } catch (error) {
    // A search hit that is not a readable ERC-20 on this chain is itself a
    // finding, so it is reported rather than swallowed.
    console.log(`  ${candidate.address}  UNREADABLE: ${error.shortMessage || error.message}`)
  }
}

// Canonical first, then by how much liquidity is standing behind the lie.
observed.sort((a, b) => {
  if (a.address === REAL) return -1
  if (b.address === REAL) return 1
  return b.liquidityUsd - a.liquidityUsd
})

console.log('')
for (const token of observed) {
  const canonical = token.address === REAL
  const mark = (canonical ? 'REAL' : 'IMPOSTOR').padEnd(8)
  console.log(`  ${mark}  ${token.address}`)
  console.log(`            name     ${JSON.stringify(token.name)}`)
  console.log(`            symbol   ${JSON.stringify(token.symbol)}`)
  console.log(`            decimals ${token.decimals}`)
  console.log(`            supply   ${formatToken(token.totalSupply, token.decimals)}`)
  console.log(
    `            pools    ${token.pairs} indexed, ` +
      `$${token.liquidityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} liquidity`,
  )
  if (!canonical && isKnownImpostor(token.address)) {
    console.log('            flagged  documented in KNOWN_IMPOSTORS (advisory only, never a security boundary)')
  }
  console.log('')
}

// ---------------------------------------------------------------------------
// Step 3: why a name check does not save you either
// ---------------------------------------------------------------------------

heading('Step 3: name and symbol are both attacker-chosen')

const sharingSymbol = observed.filter((t) => String(t.symbol).toUpperCase() === TICKER.toUpperCase())
const sharingName = observed.filter((t) => t.name === USDG.name)
const impostorsSharingName = sharingName.filter((t) => t.address !== REAL)

console.log(`  Contracts reporting symbol ${JSON.stringify(TICKER)}:  ${sharingSymbol.length}`)
console.log(`  Contracts reporting name ${JSON.stringify(USDG.name)}:  ${sharingName.length}`)

if (impostorsSharingName.length > 0) {
  console.log(
    `\n  ${impostorsSharingName.length} contract${impostorsSharingName.length === 1 ? '' : 's'} that ` +
      `${impostorsSharingName.length === 1 ? 'is' : 'are'} NOT the canonical token also self-report the ` +
      `name ${JSON.stringify(USDG.name)}:`,
  )
  for (const token of impostorsSharingName) {
    console.log(`    ${token.address}  ${token.decimals} decimals`)
  }
  console.log('\n  So checking the name does not narrow it down. Neither does checking both.')
  console.log('  The address is the only field an attacker cannot choose. Compare that.')
} else {
  console.log('\n  No impostor is currently copying the canonical name. That can change with one deploy.')
  console.log('  Compare the address regardless: it is the only field an attacker cannot choose.')
}

// ---------------------------------------------------------------------------
// Step 4: the same raw amount, formatted with each token's real decimals
// ---------------------------------------------------------------------------

heading('Step 4: one raw amount, every candidate decimals')

// This is what actually reaches your code from an eth_call: an opaque integer.
// It carries no unit. Decimals supply the unit, and getting them wrong does
// not throw. It returns a plausible number.
const RAW = 1_500_000n

console.log(`  A balanceOf call returns the raw integer ${RAW}.`)
console.log('  It carries no unit. Decimals supply the unit.\n')

const distinctDecimals = [...new Set(observed.map((t) => t.decimals))].sort((a, b) => a - b)
for (const decimals of distinctDecimals) {
  const holders = observed.filter((t) => t.decimals === decimals)
  const label = holders.some((t) => t.address === REAL) ? '(real USDG)' : '(impostor)'
  console.log(`  at ${String(decimals).padStart(2)} decimals ${label.padEnd(12)} ${formatToken(RAW, decimals)}`)
}

if (distinctDecimals.length > 1) {
  const low = Math.min(...distinctDecimals)
  const high = Math.max(...distinctDecimals)
  const ratio = 10n ** BigInt(high - low)
  console.log(
    `\n  Same integer. The ${high}-decimal reading is ${ratio.toLocaleString('en-US')}x smaller ` +
      `than the ${low}-decimal one.`,
  )
  console.log('  Neither reading throws. Both render as a believable balance.')
  console.log('  In the parse direction the same mistake moves a trillion times the intended amount.')
}

// ---------------------------------------------------------------------------
// Step 5: verification that actually holds
// ---------------------------------------------------------------------------

heading('Step 5: assertCanonicalToken against every candidate')

console.log(`  Expected: ${USDG.address}`)
console.log(`            ${JSON.stringify(USDG.name)} / ${JSON.stringify(USDG.symbol)} / ${USDG.decimals} decimals\n`)

let passed = 0
let rejected = 0

for (const token of observed) {
  const result = await verifyToken(client, token.address, USDG)
  if (result.ok) {
    passed += 1
    console.log(`  PASS  ${token.address}`)
    continue
  }
  rejected += 1
  const fields =
    result.error instanceof NotCanonicalTokenError
      ? result.error.mismatches.map((m) => m.field).join(', ')
      : 'read failure'
  console.log(`  FAIL  ${token.address}  (${fields} mismatch)`)
}

console.log(`\n  ${passed} passed, ${rejected} rejected.`)

// Prove the throwing variant too. This is the call that belongs at every
// boundary accepting an address from a user, a URL, a config file, a search
// result, or another service.
try {
  await import('robinhood-chain').then(({ assertCanonicalToken }) =>
    assertCanonicalToken(client, IMPOSTOR, USDG),
  )
  fail('assertCanonicalToken accepted the impostor. That is a bug in the package, not in this example.')
} catch (error) {
  if (!(error instanceof NotCanonicalTokenError)) throw error
  console.log(`\n  assertCanonicalToken(client, ${IMPOSTOR.slice(0, 10)}..., USDG)`)
  console.log(`  threw NotCanonicalTokenError: ${error.mismatches.map((m) => m.field).join(', ')} mismatch`)
  console.log('  It short-circuits on the address before spending a network round trip.')
}

if (passed !== 1) {
  fail(
    `Expected exactly one canonical match, got ${passed}. ` +
      'Either the canonical address changed or verification is broken. Investigate before trusting this chain data.',
  )
}

console.log('\n  Rule: resolve tokens by address. Never by symbol, never by name.')
console.log('  Symbols and names are display strings. Render them as data, escape them in HTML,')
console.log('  never route logic on them, never interpolate them into a prompt or a shell command.\n')
