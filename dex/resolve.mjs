/**
 * robinhood-toolkit · resolve Uniswap deployment addresses for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Nothing here is hardcoded per chain on purpose. Addresses come from the
 * Uniswap SDK's machine-readable maps when it knows the chain, or from env
 * overrides you populated from the official Uniswap deployment docs and then
 * proved on-chain with dex/verify.mjs. See dex/DEPLOYMENTS.md for the audit
 * trail behind the values in .env.example.
 */
import { getAddress, isAddress } from "viem";

/**
 * The SDK's address maps are an optional convenience: they only help on chains
 * the published SDK already knows, and 4663 is new enough that it will not.
 * Load it lazily and tolerate failure — some @uniswap/sdk-core builds ship a
 * broken ESM entry, and a missing convenience must never break env resolution.
 */
let sdkCore = null;
try {
  sdkCore = await import("@uniswap/sdk-core");
} catch {
  sdkCore = null;
}

/** Read a per-chain address map from the SDK if the SDK knows this chain. */
function fromSdk(mapName, chainId) {
  const map = sdkCore?.[mapName];
  const value = map?.[chainId];
  return typeof value === "string" && isAddress(value) ? getAddress(value) : null;
}

/** Env override, for addresses you confirmed from the docs and verified on-chain. */
function fromEnv(name) {
  const v = process.env[name];
  if (!v) return null;
  if (!isAddress(v)) throw new Error(`${name} is not a valid address: ${v}`);
  return getAddress(v);
}

/**
 * Returns the Uniswap addresses for a chain, or throws with instructions.
 * The three required keys are v3Factory, swapRouter02, and quoterV2 — enough to
 * quote and execute a v3 swap. The rest are optional and only needed for v2 or
 * v4 / Universal Router routes.
 */
export function resolveUniswap(chainId) {
  const resolved = {
    chainId,
    v3Factory: fromEnv("UNI_V3_FACTORY") ?? fromSdk("V3_CORE_FACTORY_ADDRESSES", chainId),
    swapRouter02: fromEnv("UNI_SWAP_ROUTER_02") ?? fromSdk("SWAP_ROUTER_02_ADDRESSES", chainId),
    quoterV2: fromEnv("UNI_QUOTER_V2"),
    v2Factory: fromEnv("UNI_V2_FACTORY") ?? fromSdk("V2_FACTORY_ADDRESSES", chainId),
    universalRouter: fromEnv("UNI_UNIVERSAL_ROUTER"),
    permit2: fromEnv("UNI_PERMIT2"),
    v4PoolManager: fromEnv("UNI_V4_POOL_MANAGER"),
  };

  const missing = ["v3Factory", "swapRouter02", "quoterV2"].filter((k) => !resolved[k]);
  if (missing.length) {
    throw new Error(
      `Missing Uniswap addresses for chain ${chainId}: ${missing.join(", ")}. ` +
        "Resolve them from https://developers.uniswap.org/contracts/v3/reference/deployments/ " +
        "and the v4 deployments page, confirm each on https://robinhoodchain.blockscout.com, " +
        "then set UNI_V3_FACTORY, UNI_SWAP_ROUTER_02, UNI_QUOTER_V2 in your environment.",
    );
  }
  return resolved;
}
