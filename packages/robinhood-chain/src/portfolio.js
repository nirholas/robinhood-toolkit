/* built by nirholas x.com/nichxbt */
/**
 * robinhood-chain · batched portfolio reads over Multicall3
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * robinhood-toolkit · package: robinhood-chain
 *
 * Read a native ETH balance plus every ERC-20 balance, symbol, and decimals in
 * as few round trips as the chain allows: one eth_getBalance and one Multicall3
 * aggregate, regardless of how many tokens are in the list.
 *
 * Two invariants this module never breaks:
 *
 *   - Decimals are read from each contract in the SAME batch as the balance,
 *     never assumed. USDG on this chain is 6, not 18; a wrong exponent misreads
 *     the balance by a factor of 10^12 and still renders as a plausible number.
 *   - symbol and name are attacker-controlled strings. They ride along for
 *     display only. No logic in this module — or any caller — should key off
 *     them. Resolve identity by address (knownTokenAt / assertCanonicalToken).
 */

import { erc20Abi, formatEther, getAddress } from 'viem'
import { MULTICALL3_ADDRESS } from './chains.js'
import { RobinhoodChainError } from './errors.js'
import { assertDecimals, formatToken } from './format.js'
import { knownTokenAt } from './tokens.js'

/**
 * Batch a list of viem contract calls through Multicall3, degrading to
 * sequential eth_call when the aggregate cannot be used.
 *
 * viem does NOT provide this fallback: client.multicall() throws
 * ChainDoesNotSupportContract when the chain definition lacks
 * contracts.multicall3, and it never falls back to individual calls on its own.
 * Passing multicallAddress explicitly makes the aggregate work even on a chain
 * def that omits the entry, and the catch here handles the case where the
 * aggregate itself is unreachable (bad address, contract not deployed).
 *
 * Always returns viem's allowFailure shape — { status, result } | { status,
 * error } — from BOTH paths, so callers read one result shape either way.
 *
 * `multicallAddress` semantics:
 *   - undefined (default): use the canonical Multicall3 address explicitly, so
 *     the aggregate works even on a chain def that omits contracts.multicall3.
 *   - an address: use that address.
 *   - null: omit it, letting viem resolve contracts.multicall3 from the chain
 *     definition — which THROWS ChainDoesNotSupportContract when absent, the
 *     one condition that reliably exercises the sequential fallback below.
 */
export async function batchRead(client, contracts, { multicallAddress } = {}) {
  if (!contracts.length) return []
  const resolved = multicallAddress === undefined ? MULTICALL3_ADDRESS : multicallAddress
  try {
    return await client.multicall({
      contracts,
      allowFailure: true,
      // Omit the key entirely when null so viem uses the chain definition.
      ...(resolved === null ? {} : { multicallAddress: resolved }),
    })
  } catch (error) {
    // The aggregate is unavailable (missing multicall3, wrong address, or the
    // contract is not deployed on this endpoint). Fall back to one call per
    // contract so a portfolio read still succeeds, just less cheaply.
    console.warn(
      '[read] multicall unavailable, falling back to sequential reads:',
      error?.shortMessage ?? error?.message ?? error,
    )
    return Promise.all(
      contracts.map((c) =>
        client
          .readContract(c)
          .then((result) => ({ status: 'success', result }))
          .catch((readError) => ({ status: 'failure', error: readError })),
      ),
    )
  }
}

/**
 * Read a full portfolio for `address`: native ETH plus a balance row for every
 * token address in `tokenAddresses`.
 *
 * @param client         a viem PublicClient pointed at a Robinhood Chain network
 * @param address        the account to read
 * @param tokenAddresses ERC-20 addresses to include (order preserved in output)
 * @param options.multicallAddress  override the Multicall3 address (for testing
 *                                   the sequential fallback with a bogus address)
 *
 * Each token row is one of:
 *   - { address, symbol, name, decimals, raw, formatted, known }  on success
 *   - { address, raw, error: 'decimals unavailable' }             balance read, decimals did not
 *   - { address, error: 'balanceOf reverted' }                    not a readable ERC-20 here
 *
 * `known` is the curated-set match from knownTokenAt (or null). It is advisory:
 * a null `known` means "not in our list", never "safe". Prove canonicality with
 * assertCanonicalToken when the address came from user input.
 *
 * @example
 * import { createPublicClient, http } from 'viem'
 * import { readPortfolio, robinhoodChain, WETH, USDG } from 'robinhood-chain'
 * const client = createPublicClient({ chain: robinhoodChain, transport: http() })
 * const portfolio = await readPortfolio(client, '0x8803c117ccae7B5146297876c2A25DF135141C4d', [
 *   WETH.address,
 *   USDG.address,
 * ])
 * console.log(portfolio.nativeEth, portfolio.tokens)
 */
export async function readPortfolio(client, address, tokenAddresses = [], { multicallAddress } = {}) {
  if (!client) throw new RobinhoodChainError('readPortfolio requires a viem `client`.')

  const owner = getAddress(address)
  // Normalize and de-duplicate by address: on a chain with a live ticker
  // collision, the address is the only identity that means anything.
  const wanted = [...new Map(tokenAddresses.map((raw) => [getAddress(raw).toLowerCase(), getAddress(raw)])).values()]

  // balanceOf + symbol + decimals for every token, three calls each, in one
  // aggregate. decimals rides with the balance so the two can never disagree.
  const contracts = wanted.flatMap((token) => [
    { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] },
    { address: token, abi: erc20Abi, functionName: 'symbol' },
    { address: token, abi: erc20Abi, functionName: 'decimals' },
  ])

  const [native, results] = await Promise.all([
    client.getBalance({ address: owner }),
    batchRead(client, contracts, { multicallAddress }),
  ])

  const tokens = wanted.map((token, i) => {
    const [bal, sym, dec] = results.slice(i * 3, i * 3 + 3)

    if (bal.status !== 'success') {
      return { address: token, error: 'balanceOf reverted' }
    }
    // Never default decimals to 18. A reverting decimals() is a degraded row,
    // not a guessed exponent. USDG is 6; a wrong default is off by 10^12 and
    // still looks like a valid balance.
    if (dec.status !== 'success') {
      return { address: token, raw: bal.result.toString(), error: 'decimals unavailable' }
    }

    const decimals = assertDecimals(dec.result, `decimals() of ${token}`)
    return {
      address: token,
      // Attacker-controlled string. Display only, never a logic key.
      symbol: sym.status === 'success' ? sym.result : 'UNKNOWN',
      decimals,
      raw: bal.result.toString(),
      formatted: formatToken(bal.result, decimals),
      // Advisory curated-set match. null does not mean "safe".
      known: knownTokenAt(token),
    }
  })

  return {
    address: owner,
    chainId: client.chain?.id ?? null,
    nativeEth: formatEther(native),
    nativeWei: native.toString(),
    tokens,
    explorer: client.chain?.blockExplorers?.default
      ? `${client.chain.blockExplorers.default.url}/address/${owner}`
      : null,
  }
}
/* built by nirholas x.com/nichxbt */
