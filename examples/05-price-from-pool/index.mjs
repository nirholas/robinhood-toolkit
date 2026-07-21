/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · example 05: pool price from sqrtPriceX96, in BigInt
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Read a Uniswap v3 pool's slot0, derive the price from sqrtPriceX96 using
 * integer math from end to end, then cross-validate the result against
 * DexScreener's independently reported priceNative. Two sources that computed
 * the same number by different routes is the only real check on price code.
 *
 * Why BigInt matters here
 * -----------------------
 * The v3 price is (sqrtPriceX96^2) / 2^192, adjusted for the decimals of both
 * tokens. That numerator is a 384-bit integer. The obvious float translation
 *
 *     Number(sqrtPriceX96 ** 2n) / Number(2n ** 192n)
 *
 * throws away everything past the 17th significant digit, and the equally
 * obvious integer translation
 *
 *     sqrtPriceX96 * sqrtPriceX96 / (2n ** 192n)
 *
 * truncates to ZERO for any price below 1, because integer division discards
 * the fraction. This program prints both wrong answers next to the right one.
 * The fix is to multiply by a scale factor BEFORE dividing, never after.
 *
 * About the default pool
 * ----------------------
 * The default pool pairs WETH against the IMPOSTOR "USDG" at
 * 0x8218d73C00567A01481495Ad6c5143e00D5BB5b4, whose on-chain name is
 * "Useless Stupid Degen Gamblers". It is NOT the canonical Global Dollar. It is
 * a real pool with real volume, which is exactly why it works as a price
 * exercise, and the program labels every token by address rather than ticker.
 *
 * The irony is the lesson: a price feed that resolved "USDG" by ticker would
 * have silently priced a memecoin as a dollar stablecoin, and every number in
 * its output would have looked completely reasonable.
 *
 * Read-only. No key, no signing, no spend.
 *
 * Usage:
 *   node index.mjs
 *   node index.mjs --pool 0xPoolAddress
 *   node index.mjs --tolerance 2       # max divergence in percent, default 5
 */

import { createPublicClient, getAddress, http, isAddress } from 'viem'
import {
  USDG,
  WETH,
  formatToken,
  knownTokenAt,
  readTokenMetadata,
  robinhoodChain,
} from 'robinhood-chain'

/**
 * Uniswap v3 WETH / "USDG" pool, where that "USDG" is the impostor at
 * 0x8218d73C..., not the canonical Global Dollar. Verified live 2026-07-20.
 */
const DEFAULT_POOL = '0x95f9B0AF9282A22F7ef57058e65098db3f667f95'

// DexScreener keys this chain by the string slug, not the numeric chain ID.
const DEXSCREENER_CHAIN_SLUG = 'robinhood'
const DEXSCREENER_PAIRS = 'https://api.dexscreener.com/latest/dex/pairs'

const Q96 = 2n ** 96n
const Q192 = 2n ** 192n

/** Fixed-point scale for every derived price. 10^30 outlives any token pair. */
const SCALE = 10n ** 30n

const poolIndex = process.argv.indexOf('--pool')
const POOL = poolIndex !== -1 ? process.argv[poolIndex + 1] : DEFAULT_POOL

const toleranceIndex = process.argv.indexOf('--tolerance')
const TOLERANCE_PCT = Number(toleranceIndex !== -1 ? process.argv[toleranceIndex + 1] : 5)

const UNISWAP_V3_POOL_ABI = [
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'fee', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
]

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

/** Render a SCALE-fixed-point integer as a decimal string with `places` digits. */
function renderScaled(scaled, places = 18) {
  const negative = scaled < 0n
  const magnitude = negative ? -scaled : scaled
  const whole = magnitude / SCALE
  const fraction = (magnitude % SCALE).toString().padStart(30, '0').slice(0, places).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

if (!isAddress(POOL, { strict: false })) {
  fail(`"${POOL}" is not a valid pool address. Pass a 0x-prefixed 20-byte address.`)
}
const pool = getAddress(POOL)

// ---------------------------------------------------------------------------
// Step 1: read the pool
// ---------------------------------------------------------------------------

console.log(`\n  Pool  ${pool}`)
console.log(`  Chain ${robinhoodChain.name} (${robinhoodChain.id})`)

let slot0
let token0Address
let token1Address
let fee
try {
  const [slot0Result, t0, t1, feeResult] = await client.multicall({
    contracts: [
      { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'slot0' },
      { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'token0' },
      { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'token1' },
      { address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'fee' },
    ],
    allowFailure: true,
  })

  if (slot0Result.status !== 'success' || t0.status !== 'success' || t1.status !== 'success') {
    fail(
      `${pool} does not answer slot0()/token0()/token1(). ` +
        'It is not a Uniswap v3 pool on this chain. Pass a v3 pool with --pool.',
    )
  }

  slot0 = slot0Result.result
  token0Address = getAddress(t0.result)
  token1Address = getAddress(t1.result)
  fee = feeResult.status === 'success' ? feeResult.result : null
} catch (error) {
  fail('Could not read the pool from Robinhood Chain.', error)
}

const sqrtPriceX96 = slot0[0]
const tick = slot0[1]

if (sqrtPriceX96 === 0n) {
  fail(`Pool ${pool} reports sqrtPriceX96 of 0. It has never been initialized, so it has no price.`)
}

// Decimals come from each token contract. Never assumed: this pair mixes an
// 18-decimal token with tokens that use 6 elsewhere on this chain, and the
// exponent difference is the whole ballgame.
const [token0, token1] = await Promise.all([
  readTokenMetadata(client, token0Address),
  readTokenMetadata(client, token1Address),
])

/** Label a token by what it verifiably is, never by its self-reported ticker. */
function describe(token) {
  const known = knownTokenAt(token.address)
  if (known && known.address === WETH.address) return 'canonical WETH'
  if (known && known.address === USDG.address) return 'canonical Global Dollar'
  if (known?.impersonates) return `IMPOSTOR, squats the ticker of ${known.impersonates}`
  return 'unverified, resolve this address yourself'
}

heading('Step 1: what is actually in this pool')

for (const [label, token] of [
  ['token0', token0],
  ['token1', token1],
]) {
  console.log(`  ${label}  ${token.address}`)
  console.log(`          name     ${JSON.stringify(token.name)}`)
  console.log(`          symbol   ${JSON.stringify(token.symbol)}  <- display only, not an identifier`)
  console.log(`          decimals ${token.decimals}`)
  console.log(`          status   ${describe(token)}`)
}

if (fee !== null) console.log(`\n  fee tier  ${Number(fee) / 10_000}%`)
console.log(`  tick      ${tick}`)
console.log(`  sqrtP     ${sqrtPriceX96}`)
console.log(`            (${sqrtPriceX96.toString(2).length} bits; squared it is ` +
  `${(sqrtPriceX96 * sqrtPriceX96).toString(2).length} bits, well past a float's 53)`)

// ---------------------------------------------------------------------------
// Step 2: the two ways to get this wrong
// ---------------------------------------------------------------------------

heading('Step 2: the two failure modes, shown before the fix')

// Wrong way 1: integer division with no scaling. The fraction is discarded.
const truncated = (sqrtPriceX96 * sqrtPriceX96) / Q192
const truncatedInverse = Q192 / (sqrtPriceX96 * sqrtPriceX96)

console.log('  a) BigInt division without scaling first:')
console.log(`       (sqrtP^2) / 2^192            = ${truncated}`)
console.log(`       (2^192) / (sqrtP^2)          = ${truncatedInverse}`)
console.log('     Integer division discards the fraction. One direction of this pair')
console.log('     is below 1 and truncates to exactly 0, taking the answer with it.')

// Wrong way 2: floats. Survives at this magnitude but silently sheds precision.
const floatPrice = Number(sqrtPriceX96) ** 2 / Number(Q192)
console.log('\n  b) float math:')
console.log(`       Number(sqrtP)^2 / Number(2^192) = ${floatPrice}`)
console.log('     It produces a plausible number here, which is what makes it dangerous.')
console.log('     Precision past the 17th significant digit is already gone, and for a')
console.log('     small enough price the leading digits go with it.')

// ---------------------------------------------------------------------------
// Step 3: the correct derivation
// ---------------------------------------------------------------------------

heading('Step 3: BigInt from end to end')

/**
 * Price of one whole token0 denominated in whole token1, as a SCALE fixed-point
 * integer.
 *
 * raw ratio            = sqrtPriceX96^2 / 2^192
 * whole-unit ratio     = raw ratio * 10^decimals0 / 10^decimals1
 *
 * Every multiplication happens before the single division, so nothing is
 * truncated until the value has already been scaled by 10^30.
 */
function price0In1({ sqrtPriceX96: sqrtP, decimals0, decimals1 }) {
  const numerator = sqrtP * sqrtP * SCALE * 10n ** BigInt(decimals0)
  const denominator = Q192 * 10n ** BigInt(decimals1)
  return numerator / denominator
}

const p0in1 = price0In1({ sqrtPriceX96, decimals0: token0.decimals, decimals1: token1.decimals })

if (p0in1 === 0n) {
  fail(
    'The derived price underflowed even at 10^30 scale. This pool is priced below 1e-30, ' +
      'which needs a larger SCALE constant.',
  )
}

// Invert in fixed point: (SCALE * SCALE) / p0in1 keeps the same scale.
const p1in0 = (SCALE * SCALE) / p0in1

console.log(`  1 ${token0.symbol} (${token0.address.slice(0, 10)}...) = ${renderScaled(p0in1)} ${token1.symbol}`)
console.log(`  1 ${token1.symbol} (${token1.address.slice(0, 10)}...) = ${renderScaled(p1in0)} ${token0.symbol}`)

// ---------------------------------------------------------------------------
// Step 4: cross-validate against an independent source
// ---------------------------------------------------------------------------

heading('Step 4: cross-validate against DexScreener')

let pair
try {
  const response = await fetch(`${DEXSCREENER_PAIRS}/${DEXSCREENER_CHAIN_SLUG}/${pool}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) fail(`DexScreener returned HTTP ${response.status} ${response.statusText}.`)
  const payload = await response.json()
  pair = payload?.pairs?.[0] ?? payload?.pair ?? null
} catch (error) {
  fail('Could not reach the DexScreener pairs API. Check your network connection.', error)
}

if (!pair) {
  fail(
    `DexScreener does not index ${pool} on "${DEXSCREENER_CHAIN_SLUG}". ` +
      'Cross-validation needs a second source, so this is a hard stop rather than a warning.',
  )
}

// priceNative is the BASE token priced in the QUOTE token. Which of token0 and
// token1 is base is DexScreener's choice, so match on address rather than
// assuming an order.
const baseIsToken0 = getAddress(pair.baseToken.address) === token0.address
const ours = baseIsToken0 ? p0in1 : p1in0

console.log(`  base      ${getAddress(pair.baseToken.address)}  (${baseIsToken0 ? 'token0' : 'token1'})`)
console.log(`  quote     ${getAddress(pair.quoteToken.address)}  (${baseIsToken0 ? 'token1' : 'token0'})`)

// Parse their decimal string into the same fixed point rather than converting
// ours to a float. The comparison stays exact on our side.
const [whole, fractionRaw = ''] = String(pair.priceNative).split('.')
const fraction = fractionRaw.padEnd(30, '0').slice(0, 30)
const theirs = BigInt(whole) * SCALE + BigInt(fraction || '0')

console.log(`\n  ours      ${renderScaled(ours)}`)
console.log(`  theirs    ${pair.priceNative}   (DexScreener priceNative)`)

if (theirs === 0n) {
  fail('DexScreener reported a priceNative of 0, so there is nothing to validate against.')
}

// Relative difference in basis points, computed in integer math.
const difference = ours > theirs ? ours - theirs : theirs - ours
const divergenceBps = (difference * 10_000n) / theirs
const divergencePct = Number(divergenceBps) / 100

console.log(`\n  divergence ${divergencePct.toFixed(4)}%  (${divergenceBps} basis points)`)
console.log(`  tolerance  ${TOLERANCE_PCT}%`)

if (pair.priceUsd) console.log(`\n  DexScreener also reports $${pair.priceUsd} per base token.`)
if (pair.liquidity?.usd) {
  console.log(`  Pool liquidity $${Number(pair.liquidity.usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}.`)
}

// Show what the float path would have reported, now that there is a reference.
const floatDerived = baseIsToken0 ? floatPrice : 1 / floatPrice
console.log(`\n  For reference, the unscaled float path gives ${floatDerived} in this direction.`)

if (divergencePct > TOLERANCE_PCT) {
  fail(
    `Divergence of ${divergencePct.toFixed(4)}% exceeds the ${TOLERANCE_PCT}% tolerance.\n` +
      '  Two independent sources disagree about this price. Do not trade on it.\n' +
      '  Likely causes: a stale slot0 on a thin pool, a mid-block read during a large swap,\n' +
      '  or a decimals mismatch between the pool tokens and what was assumed.',
  )
}

console.log(`\n  Agreement within tolerance. Two independent derivations, the same price.`)

// The lesson the default pool teaches, stated plainly.
const impostor = [token0, token1].find((t) => knownTokenAt(t.address)?.impersonates)
if (impostor) {
  const known = knownTokenAt(impostor.address)
  console.log('')
  console.log(`  Note: ${impostor.address}`)
  console.log(`  reports the ticker ${JSON.stringify(impostor.symbol)} but its on-chain name is`)
  console.log(`  ${JSON.stringify(impostor.name)}. It is not the canonical token at`)
  console.log(`  ${known.impersonates}.`)
  console.log('')
  console.log('  The price above is correct. It is the correct price OF A MEMECOIN.')
  console.log('  A feed that resolved this pool by ticker would have published it as a')
  console.log('  dollar stablecoin quote, and nothing in the output would have looked wrong.')
}

console.log('')
/* built by nirholas x.com/nichxbt */
