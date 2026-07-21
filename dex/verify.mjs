/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · on-chain verification of resolved Uniswap addresses
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * The two anchors below (WETH, USDG) are addresses this toolkit independently
 * verified on chain 4663 in prompts 04 and 06. They are NOT Uniswap addresses;
 * they are the fixed points a resolved router is checked against. A router whose
 * WETH9() is not the anchor is not the router for this chain.
 */
import { getAddress, parseAbi, zeroAddress } from "viem";

export const WETH_ROBINHOOD_MAINNET = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const USDG_ROBINHOOD_MAINNET = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

const routerAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
]);
const factoryAbi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
  "function owner() view returns (address)",
]);
const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
]);

async function requireCode(client, address, label) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") throw new Error(`${label} ${address} has no bytecode on this chain`);
}

/**
 * Prove a resolved address set before any value moves. All checks must pass.
 *   1. Bytecode exists at v3Factory, SwapRouter02, and QuoterV2.
 *   2. router.factory() equals the v3Factory you resolved.
 *   3. (chain 4663 only) router.WETH9() equals the WETH anchor for this chain.
 * Returns the address set stamped with verifiedAt on success.
 */
export async function verifyUniswap(client, addrs) {
  const chainId = await client.getChainId();
  if (chainId !== addrs.chainId) throw new Error(`RPC chainId ${chainId} != resolved ${addrs.chainId}`);

  // 1. Bytecode exists at every address.
  await requireCode(client, addrs.v3Factory, "v3Factory");
  await requireCode(client, addrs.swapRouter02, "SwapRouter02");
  await requireCode(client, addrs.quoterV2, "QuoterV2");

  // 2. The router points at the factory you resolved.
  const routerFactory = await client.readContract({
    address: addrs.swapRouter02,
    abi: routerAbi,
    functionName: "factory",
  });
  if (getAddress(routerFactory) !== getAddress(addrs.v3Factory)) {
    throw new Error(`router.factory() = ${routerFactory}, expected ${addrs.v3Factory}`);
  }

  // 3. The router's WETH9 matches the WETH address verified for this chain.
  if (chainId === 4663) {
    const weth9 = await client.readContract({
      address: addrs.swapRouter02,
      abi: routerAbi,
      functionName: "WETH9",
    });
    if (getAddress(weth9) !== WETH_ROBINHOOD_MAINNET) {
      throw new Error(`router.WETH9() = ${weth9}, expected ${WETH_ROBINHOOD_MAINNET}`);
    }
  }

  return { ...addrs, verifiedAt: new Date().toISOString() };
}

/** Find which fee tiers actually have a pool with liquidity, most liquid first. */
export async function findPools(client, factory, tokenA, tokenB, fees = [100, 500, 3000, 10000]) {
  const found = [];
  for (const fee of fees) {
    const pool = await client.readContract({
      address: getAddress(factory),
      abi: factoryAbi,
      functionName: "getPool",
      args: [getAddress(tokenA), getAddress(tokenB), fee],
    });
    if (getAddress(pool) === zeroAddress) continue;

    const [liquidity, token0, token1] = await Promise.all([
      client.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "token0" }),
      client.readContract({ address: pool, abi: poolAbi, functionName: "token1" }),
    ]);
    found.push({ fee, pool: getAddress(pool), liquidity, token0: getAddress(token0), token1: getAddress(token1) });
  }
  return found.sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0));
}
/* built by nirholas x.com/nichxbt */
