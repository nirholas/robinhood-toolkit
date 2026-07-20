<!--
  robinhood-toolkit · build prompt: resolving Stock Token addresses at runtime
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# 05 · Query the Stock Token registry (never hardcode an address)

## Goal

Build a resolver that turns a ticker like `AAPL` into a Stock Token contract
address by reading the live asset registry at runtime, verifies that address
on-chain, and refuses to return anything it could not confirm. Then wire it so
no other module in your codebase is allowed to hold a Stock Token address as a
constant.

This is the single most safety-critical prompt in this track. A Stock Token is
an ERC-20. Anyone can deploy an ERC-20 that reports `symbol() == "AAPL"`. The
name is not the identity. The address is, and only the registry decides which
address is canonical.

## Prerequisites

- Node.js 20 or newer and `viem`.
- A working public client for chain 4663 (prompt 04, step 6, exports one).
- A browser with devtools, for step 1.

## Reference facts (verified)

- Stock Tokens are ERC-20s that give economic exposure to US equities and ETFs.
  They trade 24/7 and settle in USDG.
- They are issued by Robinhood Assets (Jersey) Limited as tokenized **debt
  securities**. They grant **no legal or beneficial rights in the underlying
  equity**. No shareholder rights, no voting, no direct claim on the stock.
- Stock Token addresses live in a **dynamic on-chain asset registry** that the
  Robinhood docs render at runtime. The docs page does not ship a fixed list.
- Robinhood explicitly warns that a token matching a known name or ticker **at a
  different address is not canonical**.
- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com` (Blockscout).
- USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (proxy, confirmed bytecode)
  is the settlement asset.
- Registry source page: <https://docs.robinhood.com/chain/contracts/>.

**UNVERIFIED:** the exact HTTP endpoint or on-chain registry contract that backs
that page, and the shape of its response, are not verified in this toolkit. Step
1 has you discover them from the live source. Do not accept a registry URL from
any third party, including this file, without confirming it yourself.

## Steps

### 1. Discover the live registry source

Open <https://docs.robinhood.com/chain/contracts/> with devtools on the Network
tab, filtered to Fetch/XHR, and reload.

Identify how the address table is populated. It will be one of:

- **A JSON/HTTP endpoint** the page fetches. Record the full URL and one sample
  response body.
- **An on-chain registry contract** read via RPC. Record the contract address,
  the function selectors called, and decode them with
  `cast 4byte-decode <calldata>`.

Record what you found in `registry/SOURCE.md`: the URL or contract address, the
date checked, a sample response, and the field names that carry ticker, address,
and decimals. Everything downstream depends on this being accurate, so write
down the evidence, not a conclusion.

Cross-check on the explorer before you trust anything: pick one entry, open
`https://robinhoodchain.blockscout.com/token/<address>`, and confirm the symbol
and the token type match what the registry claimed.

### 2. Configure the source, do not embed it

`registry/config.mjs`:

```js
/**
 * robinhood-toolkit · Stock Token registry source configuration
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */

/**
 * Set RH_ASSET_REGISTRY_URL to the endpoint you confirmed in registry/SOURCE.md.
 * There is intentionally no default. A wrong default is worse than a crash.
 */
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
```

### 3. Fetch, normalize, and cache with a TTL

`registry/fetch.mjs`:

```js
/**
 * robinhood-toolkit · Stock Token registry fetch + normalize
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
```

If step 1 found an on-chain registry contract instead of an HTTP endpoint,
replace the body of `loadRegistry` with a viem `readContract` call against that
contract and keep the same return type. Everything downstream is unchanged.

### 4. Verify every resolved address on-chain

Registry membership establishes canonicity. On-chain reads establish that the
address is a real, live ERC-20 and that the metadata is consistent. Do both.

`registry/resolve.mjs`:

```js
/**
 * robinhood-toolkit · ticker -> verified Stock Token address
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
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
```

### 5. CLI

`registry/cli.mjs`:

```js
/**
 * robinhood-toolkit · registry CLI
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 */
import { createPublicClient, http } from "viem";
import { robinhoodMainnet } from "../clients/token.mjs";
import { loadRegistry } from "./fetch.mjs";
import { resolveStockToken, assertCanonicalAddress } from "./resolve.mjs";

const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
const [, , cmd, a, b] = process.argv;

try {
  if (cmd === "list") {
    const reg = await loadRegistry({ force: true });
    console.table([...reg.values()]);
  } else if (cmd === "resolve" && a) {
    console.log(await resolveStockToken(client, a, { force: true }));
  } else if (cmd === "check" && a && b) {
    console.log(await assertCanonicalAddress(client, a, b, { force: true }));
    console.log("OK: address is canonical");
  } else {
    console.error("usage: node registry/cli.mjs list | resolve <TICKER> | check <TICKER> <ADDRESS>");
    process.exit(1);
  }
} catch (err) {
  console.error(`${err.name}: ${err.message}`);
  process.exit(1);
}
```

### 6. Snapshot for drift detection, not for resolution

Write a dated snapshot to `registry/snapshots/<ISO-date>.json` on every `list`
run and commit it. Its only job is drift detection: diff today against
yesterday, and alert when an address changes, an asset is added, or an asset is
removed. Production code paths must still resolve at runtime. A committed
snapshot that starts getting read as truth is a hardcoded address with extra
steps.

### 7. Ban hardcoded addresses in CI

Add a check that fails the build when a 20-byte hex literal appears outside the
allowlist of verified infrastructure addresses (USDG, WETH):

```sh
# robinhood-toolkit · reject hardcoded token addresses
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: MIT (c) 2026 nirholas
grep -rnoiE '0x[0-9a-f]{40}' --include='*.mjs' --include='*.js' --include='*.ts' src clients registry \
  | grep -viE '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168|0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73|0x0{40}' \
  && { echo "hardcoded address found, resolve it from the registry instead"; exit 1; } || exit 0
```

## Deliverable

- `registry/SOURCE.md` documenting the live registry source, the date checked,
  a sample payload, and the field mapping.
- `registry/config.mjs`, `registry/fetch.mjs`, `registry/resolve.mjs`,
  `registry/cli.mjs`.
- `registry/snapshots/` with at least one dated snapshot.
- The CI address check wired into the project's test or lint task.
- A short section in your README stating that Stock Tokens are tokenized debt
  securities issued by Robinhood Assets (Jersey) Limited conferring no legal or
  beneficial rights in the underlying, and that addresses are resolved at
  runtime.

## How to verify

1. `node registry/cli.mjs list` prints a table of tickers and checksummed
   addresses, sourced live.
2. `node registry/cli.mjs resolve AAPL` returns an address plus on-chain
   `decimals`, `symbol`, and `name` read from chain 4663.
3. `node registry/cli.mjs check AAPL <correct-address>` exits 0.
4. `node registry/cli.mjs check AAPL 0x000000000000000000000000000000000000dEaD`
   exits non-zero with `NotCanonicalError`.
5. Unsetting `RH_ASSET_REGISTRY_URL` makes every command fail with the
   instructional error, never with a silent fallback.
6. Deploy your own ERC-20 named `AAPL` on testnet (prompt 04) and confirm
   `assertCanonicalAddress` rejects it. This is the test that proves the design.
7. The CI grep fails when you paste a Stock Token address into a source file.

## Gotchas

- **Ticker collision is the attack.** `symbol() == "AAPL"` costs one deploy. Any
  code path that selects a token by symbol rather than by registry address is
  exploitable. Symbol is for display only.
- **Never cache a resolved address across process restarts** and never promote a
  snapshot to a source of truth. The registry is dynamic by design.
- **Decimals are per token and must be read on-chain.** Do not assume 18 or 6.
  Formatting a balance with the wrong exponent silently misprices by orders of
  magnitude.
- Some Stock Tokens may be proxies. Always interact through the registry address
  and never cache an implementation address.
- If the registry returns two different addresses for one ticker, halt. Do not
  pick one. `normalizeRegistry` throws for this reason.
- A registry fetch failure must fail closed. Never fall back to the last known
  address when the live source is unreachable during a trade path.
- These are debt securities with no rights in the underlying. Do not write UI
  copy that calls them shares, stock, or equity ownership, and do not imply
  dividends or voting.
- Corporate actions such as splits, ticker changes, and delistings can change
  what a ticker maps to. Runtime resolution is what keeps you correct through
  those events. Drift detection in step 6 is what tells you one happened.
