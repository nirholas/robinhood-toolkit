/**
 * robinhood-toolkit · supply and withdraw USDG via a Morpho vault (ERC-4626)
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Two supply paths exist. This module implements the vault path — the ERC-4626
 * path that Earn-style products use — because it is the one a normal supplier
 * wants: pick a curated vault, deposit, hold shares, redeem. The direct Morpho
 * Blue path is a one-liner at the bottom for callers who intend to pick a single
 * market themselves.
 *
 * Everything here defaults to dryRun. Lending is a spend; the plan prints before
 * anything is signed.
 */
import { createWalletClient, erc20Abi, formatUnits, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { morphoAbi, vaultAbi, verifyVault } from './verify.mjs'

/**
 * Deposit USDG into a MetaMorpho / Vault V2 vault.
 *
 * The amount is parsed with the ASSET's decimals (USDG = 6), read at runtime.
 * Vault SHARE decimals are unrelated (often 18) and are never used to size the
 * deposit. Users are shown convertToAssets(shares), never a raw share count.
 */
export async function depositToVault({ publicClient, rpcUrl, privateKey, vault, usdg, amount, dryRun = true }) {
  const account = privateKeyToAccount(privateKey)
  await verifyVault(publicClient, vault, usdg)

  const decimals = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'decimals' })
  const assets = parseUnits(String(amount), decimals)

  const [balance, maxDeposit, previewShares] = await Promise.all([
    publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'maxDeposit', args: [account.address] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'previewDeposit', args: [assets] }),
  ])
  if (balance < assets) throw new Error(`insufficient USDG: have ${formatUnits(balance, decimals)}`)
  // maxDeposit can be below your balance because of a supply cap. Check before building a tx that would revert.
  if (maxDeposit < assets) throw new Error(`vault cap reached: maxDeposit ${formatUnits(maxDeposit, decimals)}`)

  const plan = {
    vault,
    assets: String(amount),
    rawAssets: assets.toString(),
    previewShares: previewShares.toString(),
  }
  if (dryRun) return { ...plan, dryRun: true }

  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(rpcUrl) })

  const allowance = await publicClient.readContract({
    address: usdg,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, vault],
  })
  if (allowance < assets) {
    const h = await wallet.writeContract({ address: usdg, abi: erc20Abi, functionName: 'approve', args: [vault, assets] })
    await publicClient.waitForTransactionReceipt({ hash: h })
  }

  const hash = await wallet.writeContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'deposit',
    args: [assets, account.address],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error(`deposit reverted: ${hash}`)

  const shares = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'balanceOf', args: [account.address] })
  const redeemable = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'convertToAssets', args: [shares] })

  return { ...plan, dryRun: false, hash, shares: shares.toString(), redeemableAssets: formatUnits(redeemable, decimals) }
}

/**
 * Redeem vault shares back to USDG. `sharesAmount` omitted means redeem the full
 * balance. Redemption can be limited by available liquidity in the underlying
 * markets even when your share balance is intact — previewRedeem tells you what
 * the shares are worth, not whether the vault can pay it right now.
 */
export async function redeemFromVault({ publicClient, rpcUrl, privateKey, vault, usdg, sharesAmount, dryRun = true }) {
  const account = privateKeyToAccount(privateKey)
  await verifyVault(publicClient, vault, usdg)

  const decimals = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'decimals' })
  const balance = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'balanceOf', args: [account.address] })
  const shares = sharesAmount === undefined ? balance : BigInt(sharesAmount)
  if (shares === 0n) throw new Error('no shares to redeem')
  if (shares > balance) throw new Error(`redeem ${shares} exceeds share balance ${balance}`)

  const [previewAssets, maxWithdraw] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'previewRedeem', args: [shares] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'maxWithdraw', args: [account.address] }),
  ])

  const plan = {
    vault,
    shares: shares.toString(),
    previewAssets: formatUnits(previewAssets, decimals),
    maxWithdrawable: formatUnits(maxWithdraw, decimals),
  }
  if (dryRun) return { ...plan, dryRun: true }

  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(rpcUrl) })
  const hash = await wallet.writeContract({
    address: vault,
    abi: vaultAbi,
    functionName: 'redeem',
    args: [shares, account.address, account.address],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error(`redeem reverted: ${hash}`)

  const usdgBalance = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
  return { ...plan, dryRun: false, hash, usdgBalance: formatUnits(usdgBalance, decimals) }
}

/**
 * Direct Morpho Blue supply, for callers who pick a single market rather than a
 * vault. Approve `morphoBlue` for `assets` on the loan token first.
 *
 * supply() takes assets AND shares and EXACTLY ONE must be zero. Passing both
 * non-zero reverts; passing shares when you meant assets silently moves the
 * wrong amount. This helper only ever supplies by assets and pins shares to 0n.
 */
export async function supplyToMarket({ publicClient, rpcUrl, privateKey, morphoBlue, marketParams, assets, dryRun = true }) {
  const account = privateKeyToAccount(privateKey)
  const plan = { morphoBlue, loanToken: marketParams.loanToken, assets: assets.toString() }
  if (dryRun) return { ...plan, dryRun: true }

  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(rpcUrl) })
  const allowance = await publicClient.readContract({
    address: marketParams.loanToken,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, morphoBlue],
  })
  if (allowance < assets) {
    const h = await wallet.writeContract({ address: marketParams.loanToken, abi: erc20Abi, functionName: 'approve', args: [morphoBlue, assets] })
    await publicClient.waitForTransactionReceipt({ hash: h })
  }

  const hash = await wallet.writeContract({
    address: morphoBlue,
    abi: morphoAbi,
    functionName: 'supply',
    // assets, then shares pinned to 0n. One of the two must be zero.
    args: [marketParams, assets, 0n, account.address, '0x'],
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
  if (receipt.status !== 'success') throw new Error(`supply reverted: ${hash}`)
  return { ...plan, dryRun: false, hash }
}
