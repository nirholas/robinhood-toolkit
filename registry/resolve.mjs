/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · ticker -> verified Stock Token address
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Registry membership establishes canonicity. On-chain reads establish that the
 * registry address is a real, live ERC-20 whose metadata is self-consistent.
 * Do both. The registry address is authoritative; the on-chain symbol is a
 * display/sanity signal, never a reason to swap in a different address. A token
 * whose symbol() reports "AAPL" at a non-registry address is not the canonical
 * Stock Token — that ticker collision is the attack this module defends against.
 */
import { erc20Abi, getAddress } from "viem";
import { loadRegistry } from "./fetch.mjs";

export class NotCanonicalError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotCanonicalError";
  }
}

/** Resolve a ticker to an address, then confirm the address on-chain. */
export async function resolveStockToken(client, tickerInput, { force = false } = {}) {
  const ticker = String(tickerInput).trim().toUpperCase();
  const registry = await loadRegistry({ force });

  const entry = registry.get(ticker);
  if (!entry) {
    throw new NotCanonicalError(
      `${ticker} is not in the live asset registry. Do not substitute a lookalike address.`,
    );
  }

  const [bytecode, symbol, decimals, name] = await Promise.all([
    client.getBytecode({ address: entry.address }),
    client.readContract({ address: entry.address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: entry.address, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: entry.address, abi: erc20Abi, functionName: "name" }),
  ]);

  if (!bytecode || bytecode === "0x") {
    throw new NotCanonicalError(`${ticker} registry address ${entry.address} has no bytecode on chain 4663`);
  }

  return {
    ticker,
    address: entry.address,
    onchainSymbol: symbol,
    onchainName: name,
    decimals,
    registryName: entry.name,
    // On-chain symbol may be decorated or differ in case from the registry ticker.
    // The registry address is authoritative; this flag is a signal to investigate,
    // never a reason to swap in a different address.
    symbolMatchesTicker: String(symbol).toUpperCase().includes(ticker),
    chainId: await client.getChainId(),
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Assert that a caller-supplied address is the canonical token for a ticker.
 * Use this at every boundary that accepts an address from a user, a config
 * file, a URL parameter, or another service.
 */
export async function assertCanonicalAddress(client, ticker, addressInput, opts = {}) {
  const candidate = getAddress(addressInput);
  const resolved = await resolveStockToken(client, ticker, opts);
  if (resolved.address !== candidate) {
    throw new NotCanonicalError(
      `${ticker.toUpperCase()} canonical address is ${resolved.address}. ` +
        `Refusing to use ${candidate}. A token with a matching name or ticker at a ` +
        "different address is not the canonical Stock Token.",
    );
  }
  return resolved;
}
/* built by nirholas x.com/nichxbt */
