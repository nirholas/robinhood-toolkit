/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Stock Token registry fetch + normalize
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Fetch the live asset registry, normalize it onto { ticker, address, name },
 * and cache it with a short TTL. The source is configured, never embedded, and
 * a fetch failure fails closed — see registry/SOURCE.md for the source and its
 * field mapping. If step 1 found an on-chain registry contract instead of an
 * HTTP endpoint, replace the body of loadRegistry() with a viem readContract
 * call against that contract and keep the same Map return type; everything
 * downstream (normalizeRegistry, resolve.mjs, cli.mjs) is unchanged.
 */
import { getAddress, isAddress } from "viem";
import { registryUrl, REGISTRY_MAX_AGE_MS } from "./config.mjs";

/**
 * Map the live payload onto { ticker, address, name }.
 * Adjust the field names to match what you recorded in registry/SOURCE.md.
 * Unknown shapes must throw, never guess.
 */
export function normalizeRegistry(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.assets)
      ? payload.assets
      : Array.isArray(payload?.tokens)
        ? payload.tokens
        : Array.isArray(payload?.data)
          ? payload.data
          : null;

  if (!rows) {
    throw new Error(
      "Unrecognized registry payload shape. Update normalizeRegistry() to match " +
        "the response documented in registry/SOURCE.md.",
    );
  }

  const out = new Map();
  for (const row of rows) {
    const ticker = row.ticker ?? row.symbol ?? row.assetSymbol;
    const address = row.address ?? row.contractAddress ?? row.tokenAddress;
    if (typeof ticker !== "string" || typeof address !== "string") continue;
    if (!isAddress(address)) throw new Error(`registry returned a non-address for ${ticker}: ${address}`);

    const key = ticker.trim().toUpperCase();
    const checksummed = getAddress(address);

    const existing = out.get(key);
    if (existing && existing.address !== checksummed) {
      throw new Error(
        `registry returned two addresses for ${key}: ${existing.address} and ${checksummed}. ` +
          "Refusing to pick one. Investigate before trading.",
      );
    }
    out.set(key, { ticker: key, address: checksummed, name: row.name ?? row.assetName ?? null });
  }

  if (out.size === 0) throw new Error("registry returned zero usable entries");
  return out;
}

let cache = { at: 0, map: null, raw: null };

export async function loadRegistry({ force = false, fetchImpl = fetch } = {}) {
  if (!force && cache.map && Date.now() - cache.at < REGISTRY_MAX_AGE_MS) return cache.map;

  const url = registryUrl();
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status} ${res.statusText} from ${url}`);

  const raw = await res.json();
  const map = normalizeRegistry(raw);
  cache = { at: Date.now(), map, raw };
  return map;
}

export function lastRawRegistry() {
  return cache.raw;
}
/* built by nirholas x.com/nichxbt */
