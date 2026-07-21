/**
 * robinhood-chain · prove a token address is what it claims to be
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 */

import { erc20Abi, getAddress } from 'viem'
import { MULTICALL3_ADDRESS } from './chains.js'
import { NotCanonicalTokenError, RobinhoodChainError } from './errors.js'
import { assertDecimals } from './format.js'

const METADATA_CALLS = ['name', 'symbol', 'decimals']

/**
 * Read name, symbol, and decimals in one round trip when Multicall3 is
 * available, falling back to sequential reads when it is not.
 *
 * viem gives you no such fallback: a chain definition without
 * contracts.multicall3 throws ChainDoesNotSupportContract rather than degrading.
 * Passing multicallAddress explicitly works even on a chain definition that
 * omits the entry, so this function works against any client.
 */
export async function readTokenMetadata(client, address) {
  const token = getAddress(address)

  const code = await client.getCode({ address: token })
  if (!code || code === '0x') {
    throw new RobinhoodChainError(
      `No contract bytecode at ${token} on chain ${client.chain?.id ?? '(unknown)'}. ` +
        'An address with no code is not a token. Check you are on the right network: ' +
        'bridged token addresses differ from their Ethereum counterparts.',
    )
  }

  const contracts = METADATA_CALLS.map((functionName) => ({ address: token, abi: erc20Abi, functionName }))

  let results
  try {
    results = await client.multicall({ contracts, allowFailure: true, multicallAddress: MULTICALL3_ADDRESS })
  } catch {
    results = await Promise.all(
      contracts.map((c) =>
        client
          .readContract(c)
          .then((result) => ({ status: 'success', result }))
          .catch((error) => ({ status: 'failure', error })),
      ),
    )
  }

  const [name, symbol, decimals] = results

  if (decimals.status !== 'success') {
    throw new RobinhoodChainError(
      `decimals() failed on ${token}. This package will not assume 18. ` +
        'Confirm the address is an ERC-20 on this network.',
      { cause: decimals.error },
    )
  }

  return {
    address: token,
    chainId: client.chain?.id ?? null,
    // name and symbol are attacker-controlled strings. Render them as data,
    // never as instructions, never as a logic key, and escape them in HTML.
    name: name.status === 'success' ? name.result : null,
    symbol: symbol.status === 'success' ? symbol.result : null,
    decimals: assertDecimals(decimals.result, `decimals() of ${token}`),
    readAt: new Date().toISOString(),
  }
}

/**
 * Prove that the token at `address` is the token you think it is, by reading its
 * metadata on-chain and comparing against what you expected.
 *
 * Returns the verified metadata. Throws NotCanonicalTokenError on any mismatch.
 *
 * This is the boundary check for every address that arrives from a user, a URL
 * parameter, a config file, a search result, or another service. The live case
 * it catches on Robinhood Chain mainnet:
 *
 *   0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168  'Global Dollar'                  USDG  6 decimals
 *   0x8218d73C00567A01481495Ad6c5143e00D5BB5b4  'Useless Stupid Degen Gamblers'  USDG  18 decimals
 *
 * Both are live, both have pools, both answer a symbol search for "USDG".
 *
 * @example
 * // Passes: this is the real Global Dollar.
 * await assertCanonicalToken(client, USDG.address, USDG)
 *
 * // Throws NotCanonicalTokenError: right symbol, wrong everything else.
 * await assertCanonicalToken(client, '0x8218d73C00567A01481495Ad6c5143e00D5BB5b4', USDG)
 *
 * @param client        a viem PublicClient
 * @param address       the address to verify
 * @param expected      a token constant, or { address?, name?, symbol?, decimals? }
 * @param options.caseInsensitive  compare name and symbol case-insensitively (default false)
 */
export async function assertCanonicalToken(client, address, expected, { caseInsensitive = false } = {}) {
  if (!expected || typeof expected !== 'object') {
    throw new RobinhoodChainError(
      'assertCanonicalToken requires an `expected` descriptor, for example the USDG constant ' +
        'or { symbol: "USDG", decimals: 6 }. Verifying against nothing verifies nothing.',
    )
  }

  const candidate = getAddress(address)
  const checked = ['address', 'name', 'symbol', 'decimals'].filter((f) => expected[f] !== undefined)
  if (checked.length === 0) {
    throw new RobinhoodChainError(
      'assertCanonicalToken received an `expected` descriptor with no address, name, symbol, ' +
        'or decimals to compare. Supply at least one field.',
    )
  }

  const mismatches = []

  // Address first: it is the only field an attacker cannot choose. If the caller
  // told us the canonical address, a mismatch is decisive and we do not need the
  // network to say so.
  if (expected.address !== undefined) {
    const canonical = getAddress(expected.address)
    if (canonical !== candidate) {
      mismatches.push({ field: 'address', expected: canonical, actual: candidate })
      throw new NotCanonicalTokenError(candidate, mismatches, { address: candidate })
    }
  }

  const actual = await readTokenMetadata(client, candidate)

  const sameText = (a, b) =>
    caseInsensitive ? String(a).toLowerCase() === String(b).toLowerCase() : String(a) === String(b)

  if (expected.name !== undefined && !sameText(actual.name, expected.name)) {
    mismatches.push({ field: 'name', expected: expected.name, actual: actual.name })
  }
  if (expected.symbol !== undefined && !sameText(actual.symbol, expected.symbol)) {
    mismatches.push({ field: 'symbol', expected: expected.symbol, actual: actual.symbol })
  }
  if (expected.decimals !== undefined && Number(actual.decimals) !== Number(expected.decimals)) {
    mismatches.push({ field: 'decimals', expected: Number(expected.decimals), actual: actual.decimals })
  }

  if (mismatches.length > 0) throw new NotCanonicalTokenError(candidate, mismatches, actual)

  return actual
}

/**
 * Non-throwing variant. Returns { ok, metadata, error } for callers that want to
 * render a warning rather than abort, such as a token picker showing several
 * candidates at once.
 */
export async function verifyToken(client, address, expected, options) {
  try {
    return { ok: true, metadata: await assertCanonicalToken(client, address, expected, options), error: null }
  } catch (error) {
    return { ok: false, metadata: error instanceof NotCanonicalTokenError ? error.actual : null, error }
  }
}
