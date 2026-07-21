/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · example 08: Morpho lending on Robinhood Chain, read-only
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Resolve → prove → discover → read the real rate, without spending anything.
 * This is the safe front half of the Morpho integration; the deposit/redeem half
 * lives in lend/vault.mjs and is exercised on a fork by fork-rehearse.mjs.
 *
 *   1. resolveMorpho(4663) from the environment (throws if MORPHO_BLUE is unset).
 *   2. verifyMorpho: owner() + DOMAIN_SEPARATOR() + IRM enabled, on-chain.
 *   3. discoverMarkets from CreateMarket logs, recompute every market id, and
 *      prove the recomputed id matches the log. This is the encoding check.
 *   4. For USDG loan markets: live utilization and the IRM-derived supply APY,
 *      compared against the reported "around 7%" headline.
 *   5. verifyVault on the configured USDG vault (asset() must equal USDG).
 *
 * Read-only. No key, no signing, no spend.
 *
 * Usage:
 *   node index.mjs                 # discovery scoped to a recent window (fast)
 *   node index.mjs --full          # scan from the Morpho deployment block
 *   node index.mjs --top 8         # show more USDG markets
 *
 * Addresses come from the environment. If they are unset, the harness loads the
 * verified record in lend/deployments.robinhood-mainnet.json and says so.
 */
import { createPublicClient, formatUnits, getAddress, http } from 'viem'
import { USDG, robinhoodChain } from 'robinhood-chain'
import { loadVerifiedDeployments, resolveMorpho } from './lend/resolve.mjs'
import { vaultAbi, verifyMorpho, verifyVault } from './lend/verify.mjs'
import { discoverMarkets, findMismatchedIds, loanMarkets, marketId } from './lend/discover.mjs'
import { marketRates } from './lend/rate.mjs'

const CHAIN_ID = robinhoodChain.id
const REPORTED_HEADLINE_APY = 0.07 // "around 7%", a headline only — never displayed as truth
const topIndex = process.argv.indexOf('--top')
const TOP = Number(topIndex !== -1 ? process.argv[topIndex + 1] : 5)
const FULL = process.argv.includes('--full')

const client = createPublicClient({ chain: robinhoodChain, transport: http(process.env.RH_RPC || undefined) })

function heading(text) {
  console.log(`\n  ${text}`)
  console.log(`  ${'-'.repeat(text.length)}`)
}

function fail(message, error) {
  console.error(`\n  ${message}`)
  if (error) console.error(`  ${error.shortMessage || error.message}`)
  console.error('')
  process.exit(1)
}

const pct = (x) => `${(x * 100).toFixed(2)}%`

// --- 1. Resolve -------------------------------------------------------------

const loaded = loadVerifiedDeployments(CHAIN_ID)
let addrs
try {
  addrs = resolveMorpho(CHAIN_ID)
} catch (error) {
  fail('Could not resolve the Morpho deployment.', error)
}

console.log(`\n  Morpho on Robinhood Chain (chain ${CHAIN_ID})`)
console.log(`  Morpho Blue  ${addrs.morphoBlue}`)
console.log(`  IRM          ${addrs.adaptiveCurveIrm ?? '(not set)'}`)
console.log(`  USDG vault   ${addrs.vault ?? '(not set)'}`)
if (loaded.loaded?.length) {
  console.log(`  (addresses loaded from the verified deployment record: ${loaded.loaded.join(', ')})`)
  console.log('  In production, set these via the environment and verify them yourself.')
}

// --- 2. Prove ---------------------------------------------------------------

heading('Proving the deployment on-chain')

let proof
try {
  proof = await verifyMorpho(client, addrs)
} catch (error) {
  fail('Verification failed. Do not trust this address.', error)
}
console.log(`  owner()             ${proof.owner}`)
console.log(`  DOMAIN_SEPARATOR()  ${proof.domainSeparator}`)
console.log(`  IRM enabled         ${proof.irmEnabled === null ? '(IRM not resolved)' : proof.irmEnabled}`)
console.log(`  verified at         ${proof.verifiedAt}`)

// --- 3. Discover + prove the market-id encoding -----------------------------

heading('Discovering markets and proving the id encoding')

const head = await client.getBlockNumber()
// CreateMarket is sparse, so we scan the whole history with a wide chunk (see
// discoverMarkets). Start from the recorded deployment block, not 0 — it saves
// the empty pre-deployment ranges. --full forces from block 0.
const deployBlock = FULL ? 0n : BigInt(loaded.record?.deploymentBlockApprox ?? 0)
console.log(`  Scanning CreateMarket logs, blocks ${deployBlock}..${head} (sparse event, wide chunks)`)
const fromBlock = deployBlock

let markets = []
try {
  const result = await discoverMarkets(client, addrs.morphoBlue, { fromBlock, toBlock: head })
  markets = result.markets
  console.log(`  ${markets.length} market(s) found in ${result.stats.chunksScanned} chunk(s), ${result.stats.halvings} halving(s)`)
} catch (error) {
  fail('Market discovery failed.', error)
}

if (markets.length === 0) {
  console.log('  No markets in this window. Re-run with --full to scan from deployment.')
} else {
  // THE check: every discovered id must recompute from its params.
  const mismatched = findMismatchedIds(markets)
  if (mismatched.length > 0) {
    fail(`${mismatched.length} market id(s) did not recompute — the MarketParams encoding is wrong.`)
  }
  console.log(`  All ${markets.length} ids recompute via keccak256(abi.encode(params)). Encoding proven.`)
  console.log(`  e.g. ${markets[0].id.slice(0, 18)}… == marketId(params) ✓`)
}

// --- 4. USDG markets: real utilization and IRM-derived supply APY -----------

heading(`USDG loan markets (top ${TOP} by supply) — real rates, not the headline`)

const usdg = getAddress(USDG.address)
let usdgWithState = []
try {
  usdgWithState = await loanMarkets(client, addrs.morphoBlue, usdg, markets)
} catch (error) {
  fail('Reading USDG market state failed.', error)
}

if (usdgWithState.length === 0) {
  console.log('  No USDG loan markets in the scanned window (try --full).')
} else {
  console.log(`  ${usdgWithState.length} USDG loan market(s). Reported headline: ~${pct(REPORTED_HEADLINE_APY)} (blended, not any one market).\n`)
  console.log('  id                  collat  supplied USDG      util     supply APY (IRM)')
  console.log('  ' + '-'.repeat(72))
  for (const m of usdgWithState.slice(0, TOP)) {
    let rates = { supplyApy: 0, utilization: m.utilization }
    if (addrs.adaptiveCurveIrm && getAddress(m.params.irm) === getAddress(addrs.adaptiveCurveIrm)) {
      rates = await marketRates(client, addrs.adaptiveCurveIrm, m.params, m)
    }
    const supplied = Number(formatUnits(m.totalSupplyAssets, USDG.decimals))
    console.log(
      `  ${m.id.slice(0, 18)}…  ` +
        `${m.params.collateralToken.slice(0, 6)}  ` +
        `${supplied.toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(15)}  ` +
        `${pct(rates.utilization).padStart(7)}  ` +
        `${pct(rates.supplyApy).padStart(10)}`,
    )
  }
  console.log('\n  Supply APY is borrowApy × utilization × (1 − fee), read from the IRM.')
  console.log('  It moves with utilization every block. A number far from the headline means')
  console.log('  your market selection is off, not the math — investigate before supplying.')
}

// --- 5. Verify the configured vault -----------------------------------------

if (addrs.vault) {
  heading('Verifying the configured USDG vault')
  try {
    const v = await verifyVault(client, addrs.vault, usdg)
    const totalAssets = await client.readContract({
      address: v.vault,
      abi: vaultAbi,
      functionName: 'totalAssets',
    })
    console.log(`  ${v.symbol} — ${v.name}`)
    console.log(`  vault    ${v.vault}`)
    console.log(`  asset()  ${v.asset}  (== USDG ✓)`)
    console.log(`  shares   ${v.shareDecimals} decimals   MORPHO() ${v.morpho ?? '(none — Vault V2)'}`)
    console.log(`  TVL      ${Number(formatUnits(totalAssets, USDG.decimals)).toLocaleString('en-US')} USDG`)
    console.log('\n  A vault is a USDG vault because asset() == USDG, never because of its name.')
  } catch (error) {
    fail('Vault verification failed — this is not a USDG vault.', error)
  }
}

console.log('\n  Read-only run complete. To actually supply, rehearse on a fork first:')
console.log('  node fork-rehearse.mjs   (needs anvil; see README).\n')
/* built by nirholas x.com/nichxbt */
