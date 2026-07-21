/**
 * robinhood-toolkit · rehearse a USDG supply + redeem against a forked chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Lending is a spend, so the first time you run deposit/redeem with dryRun:false
 * it must be against a fork, never mainnet. This script does the whole loop:
 *
 *   1. Fork must already be running (anvil --fork-url ... --chain-id 4663).
 *   2. Fund a fresh anvil account with USDG by impersonating a large holder and
 *      transferring (anvil unlocks any account; no key needed).
 *   3. depositToVault(dryRun:false): approve + deposit, read shares back.
 *   4. Advance time (evm_increaseTime + evm_mine) and poke the vault's markets so
 *      interest accrues, then confirm convertToAssets(shares) rose.
 *   5. redeemFromVault(dryRun:false): confirm USDG returned.
 *
 * Everything is printed as a transcript so the run is auditable.
 *
 * Usage:
 *   anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545 &
 *   node fork-rehearse.mjs
 *
 * Env:
 *   FORK_RPC        default http://127.0.0.1:8545
 *   AMOUNT          USDG to supply, default 1000
 *   ADVANCE_DAYS    days to fast-forward, default 30
 */
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { USDG, robinhoodChain } from 'robinhood-chain'
import { loadVerifiedDeployments, resolveMorpho } from './lend/resolve.mjs'
import { verifyMorpho, verifyVault, vaultAbi, morphoAbi } from './lend/verify.mjs'
import { discoverMarkets, loanMarkets } from './lend/discover.mjs'
import { depositToVault, redeemFromVault } from './lend/vault.mjs'

const FORK_RPC = process.env.FORK_RPC || 'http://127.0.0.1:8545'
const AMOUNT = process.env.AMOUNT || '1000'
const ADVANCE_DAYS = Number(process.env.ADVANCE_DAYS || 30)

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

async function main() {
  // Sanity: are we actually on a fork?
  const chainId = await publicClient.getChainId()
  if (chainId !== robinhoodChain.id) throw new Error(`fork chainId ${chainId} != ${robinhoodChain.id}. Is anvil forking chain 4663?`)
  line(`Connected to fork at ${FORK_RPC} (chain ${chainId})`)

  loadVerifiedDeployments(robinhoodChain.id)
  const addrs = resolveMorpho(robinhoodChain.id)
  await verifyMorpho(publicClient, addrs)
  if (!addrs.vault) throw new Error('MORPHO_USDG_VAULT is not set and no default vault in the record.')
  const v = await verifyVault(publicClient, addrs.vault, usdg)
  line(`Vault: ${v.symbol} — ${v.name} (${v.vault})`)
  line('')

  // --- Fund the account by impersonating a whale ---------------------------
  const amount = parseUnits(AMOUNT, USDG.decimals)
  const whale = await findWhale()
  line(`Funding ${account.address}`)
  line(`  impersonating holder ${whale} for ${AMOUNT} USDG`)
  await testClient.impersonateAccount({ address: whale })
  await testClient.setBalance({ address: whale, value: parseUnits('1', 18) }) // gas
  const fundHash = await wallet.writeContract({
    account: whale,
    address: usdg,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [account.address, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  await testClient.stopImpersonatingAccount({ address: whale })
  const startUsdg = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  line(`  funded balance: ${money(startUsdg)}`)
  line('')

  // --- Deposit -------------------------------------------------------------
  heading('Deposit')
  const plan = await depositToVault({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, vault: v.vault, usdg, amount: AMOUNT, dryRun: true })
  line(`plan: deposit ${plan.assets} USDG → ~${plan.previewShares} shares`)
  const deposited = await depositToVault({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, vault: v.vault, usdg, amount: AMOUNT, dryRun: false })
  line(`tx ${deposited.hash}`)
  line(`shares held: ${deposited.shares}`)
  const sharesBn = BigInt(deposited.shares)
  const before = await publicClient.readContract({ address: v.vault, abi: vaultAbi, functionName: 'convertToAssets', args: [sharesBn] })
  line(`convertToAssets(shares) now: ${money(before)}`)
  line('')

  // --- Advance time and accrue interest ------------------------------------
  heading(`Advance ${ADVANCE_DAYS} days and accrue interest`)
  await testClient.increaseTime({ seconds: ADVANCE_DAYS * 86_400 })
  await testClient.mine({ blocks: 1 })
  // Poke each USDG market this vault could touch so interest is written to state.
  const { markets } = await discoverMarkets(publicClient, addrs.morphoBlue, { fromBlock: 0n })
  const usdgMk = await loanMarkets(publicClient, addrs.morphoBlue, usdg, markets)
  let accrued = 0
  for (const m of usdgMk) {
    if (m.totalBorrowAssets === 0n) continue
    try {
      const h = await wallet.writeContract({ address: addrs.morphoBlue, abi: morphoAbi, functionName: 'accrueInterest', args: [m.params] })
      await publicClient.waitForTransactionReceipt({ hash: h })
      accrued++
    } catch { /* idle or paused market, skip */ }
  }
  line(`accrued interest on ${accrued} active USDG market(s)`)
  const after = await publicClient.readContract({ address: v.vault, abi: vaultAbi, functionName: 'convertToAssets', args: [sharesBn] })
  line(`convertToAssets(shares) now: ${money(after)}`)
  if (after > before) line(`interest accrued: +${money(after - before)}  ✓`)
  else line('no measurable accrual — vault may hold idle liquidity in this window')
  line('')

  // --- Redeem --------------------------------------------------------------
  heading('Redeem')
  const rplan = await redeemFromVault({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, vault: v.vault, usdg, dryRun: true })
  line(`plan: redeem ${rplan.shares} shares → ~${rplan.previewAssets} USDG (max withdrawable ${rplan.maxWithdrawable})`)
  const redeemed = await redeemFromVault({ publicClient, rpcUrl: FORK_RPC, privateKey: ANVIL_PK, vault: v.vault, usdg, dryRun: false })
  line(`tx ${redeemed.hash}`)
  const endUsdg = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  line(`USDG balance after redeem: ${money(endUsdg)}`)
  line('')

  heading('Result')
  line(`supplied:  ${money(amount)}`)
  line(`redeemed:  ${money(endUsdg - (startUsdg - amount))}`)
  const gain = endUsdg - startUsdg
  line(gain >= 0n ? `net vs start: +${money(gain)}  ✓ redeem returned at least the principal` : `net vs start: ${money(gain)}`)
}

function heading(t) {
  console.log(`\n  ${t}\n  ${'-'.repeat(t.length)}`)
}

/**
 * Find an address holding enough USDG to fund the test. Uses Blockscout's token
 * holders index as a discovery HINT, then confirms the balance on-chain against
 * the fork before trusting it. Scanning Transfer logs would hit the mainnet
 * matched-log cap forwarded through the fork, so we do not.
 *
 * On a fork we can impersonate anyone, so any sufficiently-funded holder works.
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
    /* fall through to a hard error below */
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
