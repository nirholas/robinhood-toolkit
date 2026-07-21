/**
 * robinhood-toolkit · rehearse a USDG supply + withdraw against a forked chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Lending is a spend, so the first time you run supply/withdraw with
 * dryRun:false it must be against a fork, never mainnet.
 *
 * PATH CHOICE. There are two supply paths (see lend/vault.mjs). This rehearsal
 * uses the DIRECT MORPHO BLUE path, deliberately:
 *
 *   The curated USDG Vault V2s on this chain (steakUSDG, ethenaUSDG, …) GATE
 *   deposits — maxDeposit() returns 0 for an arbitrary address, so an unwhitelisted
 *   forked account cannot use the vault path without impersonating the curator to
 *   lift the gate. Morpho Blue's supply() is permissionless, so the direct path
 *   is the honest thing to rehearse here. The vault path in vault.mjs is correct
 *   and is what you use once you hold a vault that admits you.
 *
 * The loop:
 *   1. Fork must already be running (anvil --fork-url … --chain-id 4663), or use
 *      run-fork.sh which starts and stops it.
 *   2. Fund a fresh anvil account with USDG by impersonating a large holder.
 *   3. Pick a USDG market with real borrow activity so interest actually accrues.
 *   4. supplyToMarket(dryRun:false): approve + supply by assets (shares pinned 0).
 *   5. Advance time, accrueInterest, and confirm the position's USDG value rose.
 *   6. withdrawFromMarket(dryRun:false): withdraw the full share position, and
 *      confirm more USDG came back than went in.
 *
 * Usage:
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545 &
 *   node fork-rehearse.mjs
 *
 * Env: FORK_RPC (default http://127.0.0.1:8545), AMOUNT (default 1000),
 *      ADVANCE_DAYS (default 365 — a big jump so accrual is visible on small size).
 */
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { USDG, robinhoodChain } from 'robinhood-chain'
import { loadVerifiedDeployments, resolveMorpho } from './lend/resolve.mjs'
import { verifyMorpho, morphoAbi } from './lend/verify.mjs'
import { discoverMarkets, loanMarkets, supplyAssetsOf } from './lend/discover.mjs'
import { marketRates } from './lend/rate.mjs'
import { supplyToMarket, withdrawFromMarket } from './lend/vault.mjs'

const FORK_RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545'
const AMOUNT = process.env.AMOUNT || '1000'
const ADVANCE_DAYS = Number(process.env.ADVANCE_DAYS || 365)

// anvil's first default account. Publicly known test key — never used off a fork.
const ANVIL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const forkChain = { ...robinhoodChain, rpcUrls: { default: { http: [FORK_RPC] } } }
const publicClient = createPublicClient({ chain: forkChain, transport: http(FORK_RPC) })
const testClient = createTestClient({ chain: forkChain, mode: 'anvil', transport: http(FORK_RPC) })
const account = privateKeyToAccount(ANVIL_PK)
const wallet = createWalletClient({ account, chain: forkChain, transport: http(FORK_RPC) })

const usdg = USDG.address
const line = (s = '') => console.log(`  ${s}`)
const money = (raw) => `${Number(formatUnits(raw, USDG.decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })} USDG`
const heading = (t) => console.log(`\n  ${t}\n  ${'-'.repeat(t.length)}`)

async function main() {
  const chainId = await publicClient.getChainId()
  if (chainId !== robinhoodChain.id) throw new Error(`fork chainId ${chainId} != ${robinhoodChain.id}. Is anvil forking chain 4663?`)
  line(`Connected to fork at ${FORK_RPC} (chain ${chainId})`)

  loadVerifiedDeployments(robinhoodChain.id)
  const addrs = resolveMorpho(robinhoodChain.id)
  await verifyMorpho(publicClient, addrs)

  // --- Discover markets and pick one with real borrow activity -------------
  const { markets } = await discoverMarkets(publicClient, addrs.morphoBlue, { fromBlock: 0n })
  const usdgMk = await loanMarkets(publicClient, addrs.morphoBlue, usdg, markets)
  const target = usdgMk.find((m) => m.totalBorrowAssets > 0n && m.utilization > 0.2 && m.totalSupplyAssets > 0n)
  if (!target) throw new Error('no active USDG market found to supply into')
  const rates = await marketRates(publicClient, addrs.adaptiveCurveIrm, target.params, target)
  line(`Market ${target.id.slice(0, 18)}…  util ${(rates.utilization * 100).toFixed(2)}%  supply APY ${(rates.supplyApy * 100).toFixed(2)}%`)
  line('')

  // --- Fund the account by impersonating a whale ---------------------------
  const amount = parseUnits(AMOUNT, USDG.decimals)
  const whale = await findWhale()
  line(`Funding ${account.address} with ${AMOUNT} USDG (impersonating ${whale})`)
  await testClient.impersonateAccount({ address: whale })
  await testClient.setBalance({ address: whale, value: parseUnits('1', 18) })
  const fundHash = await wallet.writeContract({ account: whale, address: usdg, abi: erc20Abi, functionName: 'transfer', args: [account.address, amount] })
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  await testClient.stopImpersonatingAccount({ address: whale })
  const startUsdg = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  line(`funded balance: ${money(startUsdg)}`)

  // --- Supply --------------------------------------------------------------
  heading('Supply (direct Morpho Blue)')
  const plan = await supplyToMarket({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, morphoBlue: addrs.morphoBlue, marketParams: target.params, assets: amount, dryRun: true })
  line(`plan: supply ${money(amount)} into ${plan.loanToken.slice(0, 10)}… (shares pinned to 0)`)
  const supplied = await supplyToMarket({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, morphoBlue: addrs.morphoBlue, marketParams: target.params, assets: amount, dryRun: false })
  line(`tx ${supplied.hash}`)
  const before = await supplyAssetsOf(publicClient, addrs.morphoBlue, target.id, account.address)
  line(`position: ${before.supplyShares} shares  ≈ ${money(before.assets)}`)

  // --- Advance time and accrue --------------------------------------------
  heading(`Advance ${ADVANCE_DAYS} days and accrue interest`)
  await testClient.increaseTime({ seconds: ADVANCE_DAYS * 86_400 })
  await testClient.mine({ blocks: 1 })
  const accrueHash = await wallet.writeContract({ address: addrs.morphoBlue, abi: morphoAbi, functionName: 'accrueInterest', args: [target.params] })
  await publicClient.waitForTransactionReceipt({ hash: accrueHash })
  const after = await supplyAssetsOf(publicClient, addrs.morphoBlue, target.id, account.address)
  line(`position now: ${money(after.assets)}`)
  if (after.assets > before.assets) line(`interest accrued: +${money(after.assets - before.assets)}  ✓`)
  else line('no accrual observed — market may have gone idle over the window')

  // --- Withdraw ------------------------------------------------------------
  heading('Withdraw (full position)')
  const wplan = await withdrawFromMarket({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, morphoBlue: addrs.morphoBlue, marketParams: target.params, shares: after.supplyShares, dryRun: true })
  line(`plan: withdraw ${wplan.shares} shares (assets pinned to 0)`)
  const withdrawn = await withdrawFromMarket({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, morphoBlue: addrs.morphoBlue, marketParams: target.params, shares: after.supplyShares, dryRun: false })
  line(`tx ${withdrawn.hash}`)
  const endUsdg = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  line(`USDG balance after withdraw: ${money(endUsdg)}`)

  // --- Result --------------------------------------------------------------
  heading('Result')
  line(`supplied:      ${money(amount)}`)
  const returned = endUsdg - (startUsdg - amount)
  line(`withdrew back: ${money(returned)}`)
  const gain = returned - amount
  line(gain >= 0n ? `interest earned over ${ADVANCE_DAYS}d: +${money(gain)}  ✓ withdraw returned principal + interest` : `net: ${money(gain)}`)
}

/**
 * Find an address holding enough USDG to fund the test. Uses Blockscout's token
 * holders index as a discovery HINT, then confirms the balance on-chain against
 * the fork before trusting it. Scanning Transfer logs would hit the mainnet
 * matched-log cap forwarded through the fork, so we do not.
 */
async function findWhale() {
  const need = parseUnits(AMOUNT, USDG.decimals)
  const url =
    'https://robinhoodchain.blockscout.com/api?module=token&action=getTokenHolders' +
    `&contractaddress=${usdg}&page=1&offset=20`
  let holders = []
  try {
    const res = await fetch(url)
    const body = await res.json()
    holders = (body.result ?? []).map((h) => h.address)
  } catch {
    /* fall through to the hard error below */
  }
  for (const c of holders) {
    if (!c || /^0x0+$/.test(c)) continue
    const bal = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [c] })
    if (bal >= need) return c
  }
  throw new Error(`no USDG holder with >= ${AMOUNT} USDG found via the holders index`)
}

main().catch((e) => {
  console.error(`\n  fork rehearsal failed: ${e.shortMessage || e.message}\n`)
  process.exit(1)
})
