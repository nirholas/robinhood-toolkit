/**
 * robinhood-toolkit · resolve Morpho deployment addresses for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * This resolver deliberately carries NO addresses. Morpho Blue is permissionless
 * and its deployment on chain 4663 is not a constant this toolkit ships. You
 * resolve it once from an official Morpho source, prove it on-chain with
 * verify.mjs, record it in lend/DEPLOYMENTS.md, and feed it back in through the
 * environment. The verified record for Robinhood Chain mainnet lives beside this
 * file in deployments.robinhood-mainnet.json; loadVerifiedDeployments() below
 * reads it into the environment for demos, but resolveMorpho() itself stays
 * strict so a wrong-chain or unset-address bug fails loudly at the boundary.
 */
import { readFileSync } from 'node:fs'
import { getAddress, isAddress } from 'viem'

function fromEnv(name, required = false) {
  const v = process.env[name]
  if (!v) {
    if (required) {
      throw new Error(
        `${name} is not set. Resolve the Morpho deployment for this chain from ` +
          'https://docs.morpho.org (address registry), cross-check the Morpho API ' +
          '(https://blue-api.morpho.org/graphql indexes chain 4663), and confirm the ' +
          'bytecode on https://robinhoodchain.blockscout.com before setting it. ' +
          'The verified value is recorded in lend/DEPLOYMENTS.md.',
      )
    }
    return null
  }
  if (!isAddress(v)) throw new Error(`${name} is not a valid address: ${v}`)
  return getAddress(v)
}

/**
 * Resolve Morpho addresses from the environment. Throws when MORPHO_BLUE is
 * unset — the toolkit does not guess a lending contract for you.
 */
export function resolveMorpho(chainId) {
  if (chainId !== 4663 && chainId !== 46630) throw new Error(`unsupported chainId ${chainId}`)
  return {
    chainId,
    morphoBlue: fromEnv('MORPHO_BLUE', true),
    adaptiveCurveIrm: fromEnv('MORPHO_IRM'),
    metaMorphoFactory: fromEnv('MORPHO_METAMORPHO_FACTORY'),
    // Optional: a specific vault you intend to use, discovered in step 3.
    vault: fromEnv('MORPHO_USDG_VAULT'),
  }
}

/**
 * Load the verified-on-chain deployment record into process.env for a chain,
 * without overwriting anything already set. This is a convenience for the demo
 * harness so it can run without a hand-written .env; production callers should
 * set the variables explicitly and never rely on a committed address file.
 *
 * The JSON it reads is DATA, not a source constant. It is the machine-readable
 * twin of lend/DEPLOYMENTS.md and every field in it was proven with verify.mjs.
 */
export function loadVerifiedDeployments(chainId, { override = false } = {}) {
  const file = new URL(
    chainId === 46630 ? './deployments.robinhood-testnet.json' : './deployments.robinhood-mainnet.json',
    import.meta.url,
  )
  let record
  try {
    record = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { loaded: [], reason: `no verified deployment record for chain ${chainId}` }
  }
  const map = {
    MORPHO_BLUE: record.morphoBlue,
    MORPHO_IRM: record.adaptiveCurveIrm,
    MORPHO_METAMORPHO_FACTORY: record.metaMorphoFactory,
    MORPHO_USDG_VAULT: record.defaultVault,
  }
  const loaded = []
  for (const [name, value] of Object.entries(map)) {
    if (!value) continue
    if (!override && process.env[name]) continue
    process.env[name] = value
    loaded.push(name)
  }
  return { loaded, record }
}
