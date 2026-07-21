/**
 * robinhood-toolkit · resolve + prove Uniswap addresses, then scan WETH/USDG pools
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Usage (copy dex/.env.example to dex/.env first):
 *   node --env-file=dex/.env dex/check.mjs                        # mainnet 4663, public RPC
 *   RPC_URL=http://127.0.0.1:8545 node --env-file=dex/.env dex/check.mjs   # against a fork
 *
 * This is the entry point behind the "How to verify" steps and the source of the
 * transcript recorded in dex/DEPLOYMENTS.md. It moves no value.
 */
import { createPublicClient, defineChain, formatUnits, http } from "viem";
import { resolveUniswap } from "./resolve.mjs";
import { verifyUniswap, findPools, WETH_ROBINHOOD_MAINNET, USDG_ROBINHOOD_MAINNET } from "./verify.mjs";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 4663);
const RPC_URL = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

// Minimal chain def so dex/ stays self-contained. Prompt 04 exports the full one.
const chain = defineChain({
  id: CHAIN_ID,
  name: `Robinhood Chain ${CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

const client = createPublicClient({ chain, transport: http(RPC_URL) });

const resolved = resolveUniswap(CHAIN_ID);
console.log("resolved:", JSON.stringify(resolved, null, 2));

const verified = await verifyUniswap(client, resolved);
console.log("\nverified ✓ (bytecode, router.factory(), router.WETH9())");
console.log("  verifiedAt:", verified.verifiedAt);

const pools = await findPools(client, resolved.v3Factory, WETH_ROBINHOOD_MAINNET, USDG_ROBINHOOD_MAINNET);
console.log(`\nWETH/USDG pools (${pools.length}):`);
for (const p of pools) {
  console.log(`  fee ${p.fee}: pool ${p.pool}  liquidity ${p.liquidity}  token0 ${p.token0} token1 ${p.token1}`);
}
if (!pools.length) console.log("  (none — Uniswap may be deployed but this pair may have no pool)");
