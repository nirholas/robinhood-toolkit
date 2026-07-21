/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Stock Token registry source configuration
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Set RH_ASSET_REGISTRY_URL to the endpoint you confirmed in registry/SOURCE.md.
 * There is intentionally no default. A wrong default is worse than a crash: a
 * silent fallback to a stale or attacker-supplied address is exactly the failure
 * this whole module exists to prevent.
 */

/** The confirmed registry endpoint, or throw with instructions. Never returns a default. */
export function registryUrl() {
  const url = process.env.RH_ASSET_REGISTRY_URL;
  if (!url) {
    throw new Error(
      "RH_ASSET_REGISTRY_URL is not set. Discover the live registry source from " +
        "https://docs.robinhood.com/chain/contracts/ and record it in registry/SOURCE.md. " +
        "Do not hardcode Stock Token addresses.",
    );
  }
  return url;
}

export const REGISTRY_MAX_AGE_MS = Number(process.env.RH_REGISTRY_MAX_AGE_MS ?? 5 * 60 * 1000);
/* built by nirholas x.com/nichxbt */
