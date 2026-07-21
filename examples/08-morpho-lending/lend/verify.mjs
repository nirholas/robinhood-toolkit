/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · on-chain verification of the Morpho deployment
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Resolving an address from a registry is a claim. This module is the proof. An
 * address only becomes MORPHO_BLUE after both owner() and DOMAIN_SEPARATOR()
 * answer, and a vault only becomes a USDG vault after its asset() returns the
 * exact USDG address the rest of the toolkit already verified.
 */
import { getAddress, parseAbi } from 'viem'
import { USDG } from 'robinhood-chain'

/** The one asset every USDG vault must point at. Sourced from the chain SDK, not re-typed. */
export const USDG_ROBINHOOD_MAINNET = getAddress(USDG.address)

export const morphoAbi = parseAbi([
  'function owner() view returns (address)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function isIrmEnabled(address) view returns (bool)',
  'function isLltvEnabled(uint256) view returns (bool)',
  'function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function supply((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv), uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)',
  'function withdraw((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv), uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)',
  'function accrueInterest((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv))',
])

export const vaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalAssets() view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function maxWithdraw(address) view returns (uint256)',
  'function previewDeposit(uint256) view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
  'function balanceOf(address) view returns (uint256)',
  'function MORPHO() view returns (address)',
])

/**
 * Prove an address is Morpho Blue. Both view calls must succeed: an unrelated
 * contract will answer one and revert the other, or revert both. A non-zero
 * DOMAIN_SEPARATOR is the load-bearing signal here.
 */
export async function verifyMorpho(client, addrs) {
  const chainId = await client.getChainId()
  if (chainId !== addrs.chainId) throw new Error(`RPC chainId ${chainId} != resolved ${addrs.chainId}`)

  const code = await client.getCode({ address: addrs.morphoBlue })
  if (!code || code === '0x') throw new Error(`MORPHO_BLUE ${addrs.morphoBlue} has no bytecode`)

  const [owner, domain] = await Promise.all([
    client.readContract({ address: addrs.morphoBlue, abi: morphoAbi, functionName: 'owner' }),
    client.readContract({ address: addrs.morphoBlue, abi: morphoAbi, functionName: 'DOMAIN_SEPARATOR' }),
  ])
  if (!domain || /^0x0+$/.test(domain)) throw new Error(`MORPHO_BLUE DOMAIN_SEPARATOR is zero — not Morpho Blue`)

  // If the IRM was resolved too, confirm Morpho actually recognises it. A market
  // referencing an IRM the singleton has not enabled cannot have been created.
  let irmEnabled = null
  if (addrs.adaptiveCurveIrm) {
    irmEnabled = await client.readContract({
      address: addrs.morphoBlue,
      abi: morphoAbi,
      functionName: 'isIrmEnabled',
      args: [addrs.adaptiveCurveIrm],
    })
  }

  return {
    ...addrs,
    owner: getAddress(owner),
    domainSeparator: domain,
    irmEnabled,
    verifiedAt: new Date().toISOString(),
  }
}

/**
 * A vault is only usable if its underlying asset is the USDG you verified. This
 * is the strong check: a vault whose name says "USDG" but whose asset() is some
 * other token is not a USDG vault, regardless of what it is called.
 */
export async function verifyVault(client, vault, expectedAsset = USDG_ROBINHOOD_MAINNET) {
  const [asset, name, symbol, decimals, morpho] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'asset' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'name' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'symbol' }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'decimals' }),
    // MORPHO() exists on MetaMorpho V1 but not on Vault V2. Absence is not a fault.
    client.readContract({ address: vault, abi: vaultAbi, functionName: 'MORPHO' }).catch(() => null),
  ])
  if (getAddress(asset) !== getAddress(expectedAsset)) {
    throw new Error(`vault ${vault} asset() = ${asset}, expected ${expectedAsset}`)
  }
  return {
    vault: getAddress(vault),
    asset: getAddress(asset),
    name,
    symbol,
    shareDecimals: Number(decimals),
    morpho: morpho ? getAddress(morpho) : null,
  }
}
/* built by nirholas x.com/nichxbt */
