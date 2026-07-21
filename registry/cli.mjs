/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · registry CLI
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Usage:
 *   RH_ASSET_REGISTRY_URL=<confirmed source> node registry/cli.mjs list
 *   RH_ASSET_REGISTRY_URL=<confirmed source> node registry/cli.mjs resolve AAPL
 *   RH_ASSET_REGISTRY_URL=<confirmed source> node registry/cli.mjs check AAPL 0x...
 *
 * `list` also writes a dated snapshot to registry/snapshots/<ISO-date>.json for
 * drift detection only (step 6). Production paths resolve at runtime; a snapshot
 * is never a source of truth. See registry/SOURCE.md before setting the URL.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { robinhoodMainnet } from "../clients/token.mjs";
import { loadRegistry } from "./fetch.mjs";
import { resolveStockToken, assertCanonicalAddress } from "./resolve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Write a dated, sorted snapshot for drift detection — never read back as truth. */
function writeSnapshot(reg) {
  const entries = [...reg.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  const date = new Date().toISOString().slice(0, 10);
  const dir = join(HERE, "snapshots");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${date}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), source: process.env.RH_ASSET_REGISTRY_URL, count: entries.length, entries },
      null,
      2,
    ) + "\n",
  );
  return file;
}

const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
const [, , cmd, a, b] = process.argv;

try {
  if (cmd === "list") {
    const reg = await loadRegistry({ force: true });
    console.table([...reg.values()]);
    console.log(`snapshot written: ${writeSnapshot(reg)}`);
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
/* built by nirholas x.com/nichxbt */
