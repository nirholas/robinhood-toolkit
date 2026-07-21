<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: Morpho lending integration on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 08 · Integrate Morpho lending

## Goal

Supply USDG into Morpho on Robinhood Chain from your own code: resolve the
Morpho deployment addresses from official Morpho sources, verify them on-chain,
discover markets and vaults by querying rather than by hardcoding, read the real
current rate instead of trusting a headline APY, supply, and withdraw. Rehearse
on a fork first.

## Prerequisites

- Prompts 04, 05, 06, and 07 completed. You have viem chain definitions, the
  runtime registry resolver, a USDG module, and the pattern for resolving and
  proving third-party deployment addresses.
- Node.js 20 with `viem`. Anvil for the fork rehearsal.
- USDG in the account you will supply from, plus ETH for gas.

## Reference facts (verified)

- Morpho is reported live on Robinhood Chain and powers Robinhood Earn lending,
  with a reported figure of around 7% APY on USDG.
- USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, a proxy with confirmed
  bytecode, is the asset in question.
- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com` (Blockscout).
- Arbitrum Orbit (Nitro), fully EVM compatible, so stock Morpho contracts and
  ABIs work unmodified.

Treat "around 7% APY" as a reported headline number, not a contract guarantee.
It is variable, it is a function of utilization, and step 4 reads the real
current value on-chain. Never display a hardcoded APY in a UI.

**UNVERIFIED and must be resolved by you:** the Morpho Blue address on chain
4663, the addresses and identities of any MetaMorpho vaults, the market IDs, the
oracle and IRM addresses per market, and the LLTV values. This toolkit does not
carry them. Resolve in step 1, prove in step 2, discover markets in step 3.

## Steps

### 1. Resolve the Morpho deployment

Check, in this order:

1. Morpho docs address registry at <https://docs.morpho.org>, which lists
   deployments per chain.
2. The Morpho SDK packages published to npm, which carry per-chain address maps.
3. The Morpho API, if it indexes chain 4663. Whether it does is UNVERIFIED.
   Test it before depending on it.
4. Blockscout on chain 4663, to confirm the contract exists with verified source.

`lend/resolve.mjs`:

```js
/**
 * robinhood-toolkit · resolve Morpho deployment addresses for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getAddress, isAddress } from "viem";

function fromEnv(name, required = false) {
  const v = process.env[name];
  if (!v) {
    if (required) {
      throw new Error(
        `${name} is not set. Resolve the Morpho deployment for this chain from ` +
          "https://docs.morpho.org (address registry) and confirm it on " +
          "https://robinhoodchain.blockscout.com before setting it.",
      );
    }
    return null;
  }
  if (!isAddress(v)) throw new Error(`${name} is not a valid address: ${v}`);
  return getAddress(v);
}

export function resolveMorpho(chainId) {
  if (chainId !== 4663 && chainId !== 46630) throw new Error(`unsupported chainId ${chainId}`);
  return {
    chainId,
    morphoBlue: fromEnv("MORPHO_BLUE", true),
    adaptiveCurveIrm: fromEnv("MORPHO_IRM"),
    metaMorphoFactory: fromEnv("MORPHO_METAMORPHO_FACTORY"),
    // Optional: a specific vault you intend to use, discovered in step 3.
    vault: fromEnv("MORPHO_USDG_VAULT"),
  };
}
```

If a Morpho SDK version you install exposes a per-chain address map that
includes 4663, read it there and keep the env variables as an override. The
structure above does not change.

### 2. Prove the address on-chain

`lend/verify.mjs`:

```js
/**
 * robinhood-toolkit · on-chain verification of the Morpho deployment
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getAddress, parseAbi } from "viem";

export const USDG_ROBINHOOD_MAINNET = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

export const morphoAbi = parseAbi([
  "function owner() view returns (address)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function isIrmEnabled(address) view returns (bool)",
  "function isLltvEnabled(uint256) view returns (bool)",
  "function idToMarketParams(bytes32) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function position(bytes32, address) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function supply((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv), uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)",
  "function withdraw((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv), uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
  "function accrueInterest((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv))",
]);

export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function maxDeposit(address) view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
  "function balanceOf(address) view returns (uint256)",
  "function MORPHO() view returns (address)",
]);

export async function verifyMorpho(client, addrs) {
  const chainId = await client.getChainId();
  if (chainId !== addrs.chainId) throw new Error(`RPC chainId ${chainId} != resolved ${addrs.chainId}`);

  const code = await client.getBytecode({ address: addrs.morphoBlue });
  if (!code || code === "0x") throw new Error(`MORPHO_BLUE ${addrs.morphoBlue} has no bytecode`);

  // Both calls must succeed for this to be Morpho Blue and not an unrelated contract.
  const [owner, domain] = await Promise.all([
    client.readContract({ address: addrs.morphoBlue, abi: morphoAbi, functionName: "owner" }),
    client.readContract({ address: addrs.morphoBlue, abi: morphoAbi, functionName: "DOMAIN_SEPARATOR" }),
  ]);

  return { ...addrs, owner: getAddress(owner), domainSeparator: domain, verifiedAt: new Date().toISOString() };
}

/** A vault is only usable if its underlying asset is the USDG you verified. */
export async function verifyVault(client, vault, expectedAsset = USDG_ROBINHOOD_MAINNET) {
  const [asset, name, symbol, morpho] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "asset" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "name" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "symbol" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "MORPHO" }).catch(() => null),
  ]);
  if (getAddress(asset) !== getAddress(expectedAsset)) {
    throw new Error(`vault ${vault} asset() = ${asset}, expected ${expectedAsset}`);
  }
  return { vault: getAddress(vault), asset: getAddress(asset), name, symbol, morpho };
}
```

`verifyVault` is the strong check: a vault claiming to be a USDG vault whose
`asset()` is not `0x5fc5...d168` is not one, regardless of its name.

### 3. Discover markets and vaults, do not hardcode them

Morpho Blue market IDs are `keccak256(abi.encode(marketParams))`. Compute them,
and discover existing markets from `CreateMarket` logs.

`lend/discover.mjs`:

```js
/**
 * robinhood-toolkit · discover Morpho markets and vaults on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { encodeAbiParameters, getAddress, keccak256, parseAbiItem } from "viem";
import { morphoAbi } from "./verify.mjs";

const MARKET_PARAMS_TYPE = [
  {
    type: "tuple",
    components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },
];

export function marketId(params) {
  return keccak256(encodeAbiParameters(MARKET_PARAMS_TYPE, [params]));
}

const createMarketEvent = parseAbiItem(
  "event CreateMarket(bytes32 indexed id, (address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams)",
);

/**
 * Scan CreateMarket logs in chunks. Blocks are around 101 ms on this chain, so
 * ranges get large fast. See prompt 10 for the chunked indexing pattern.
 */
export async function discoverMarkets(client, morphoBlue, { fromBlock = 0n, toBlock, chunk = 50_000n } = {}) {
  const head = toBlock ?? (await client.getBlockNumber());
  const markets = [];
  for (let start = fromBlock; start <= head; start += chunk) {
    const end = start + chunk - 1n > head ? head : start + chunk - 1n;
    const logs = await client.getLogs({ address: morphoBlue, event: createMarketEvent, fromBlock: start, toBlock: end });
    for (const log of logs) {
      markets.push({ id: log.args.id, params: log.args.marketParams, block: log.blockNumber });
    }
  }
  return markets;
}

/** Filter to markets where a given token is the loan asset, sorted by supply. */
export async function usdgMarkets(client, morphoBlue, usdg, markets) {
  const target = getAddress(usdg);
  const matching = markets.filter((m) => getAddress(m.params.loanToken) === target);

  const withState = [];
  for (const m of matching) {
    const state = await client.readContract({ address: morphoBlue, abi: morphoAbi, functionName: "market", args: [m.id] });
    const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = state;
    withState.push({
      ...m,
      totalSupplyAssets,
      totalSupplyShares,
      totalBorrowAssets,
      totalBorrowShares,
      lastUpdate,
      fee,
      utilization: totalSupplyAssets === 0n ? 0 : Number((totalBorrowAssets * 10_000n) / totalSupplyAssets) / 10_000,
    });
  }
  return withState.sort((a, b) => (b.totalSupplyAssets > a.totalSupplyAssets ? 1 : -1));
}
```

If the Morpho API indexes chain 4663, use it to discover vaults quickly and then
confirm each result on-chain with `verifyVault`. Treat the API as a discovery
hint and the chain as the truth.

### 4. Read the real rate, never a hardcoded APY

The market's borrow rate comes from the IRM. Supply APY is derived from the
borrow rate, utilization, and the market fee.

`lend/rate.mjs`:

```js
/**
 * robinhood-toolkit · Morpho rate reader
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { parseAbi } from "viem";

const irmAbi = parseAbi([
  "function borrowRateView((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv), (uint128 totalSupplyAssets,uint128 totalSupplyShares,uint128 totalBorrowAssets,uint128 totalBorrowShares,uint128 lastUpdate,uint128 fee)) view returns (uint256)",
]);

const SECONDS_PER_YEAR = 31_536_000;
const WAD = 10n ** 18n;

/** borrowRatePerSecond is WAD-scaled. Convert to a compounded annual rate. */
export function toApy(ratePerSecondWad) {
  const perSecond = Number(ratePerSecondWad) / Number(WAD);
  return Math.expm1(perSecond * SECONDS_PER_YEAR);
}

export async function marketRates(client, irm, params, state) {
  const borrowRate = await client.readContract({
    address: irm,
    abi: irmAbi,
    functionName: "borrowRateView",
    args: [params, state],
  });
  const borrowApy = toApy(borrowRate);
  const utilization =
    state.totalSupplyAssets === 0n
      ? 0
      : Number((state.totalBorrowAssets * 10_000n) / state.totalSupplyAssets) / 10_000;
  const feeFraction = Number(state.fee) / Number(WAD);
  const supplyApy = borrowApy * utilization * (1 - feeFraction);
  return { borrowRatePerSecond: borrowRate, borrowApy, supplyApy, utilization, fee: feeFraction };
}
```

Compare the number this returns against the reported "around 7%". If they differ
materially, your market selection is probably wrong, not the math. Investigate
before supplying.

### 5. Supply and withdraw

Two paths. Pick one and be explicit about which.

**Vault path (ERC-4626, what Earn-style products use):**

```js
/**
 * robinhood-toolkit · supply USDG to a MetaMorpho vault
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createWalletClient, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi, verifyVault } from "./verify.mjs";

export async function depositToVault({ publicClient, rpcUrl, privateKey, vault, usdg, amount, dryRun = true }) {
  const account = privateKeyToAccount(privateKey);
  await verifyVault(publicClient, vault, usdg);

  const decimals = await publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "decimals" });
  const assets = parseUnits(String(amount), decimals);

  const [balance, maxDeposit, previewShares] = await Promise.all([
    publicClient.readContract({ address: usdg, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "maxDeposit", args: [account.address] }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "previewDeposit", args: [assets] }),
  ]);
  if (balance < assets) throw new Error(`insufficient USDG: have ${formatUnits(balance, decimals)}`);
  if (maxDeposit < assets) throw new Error(`vault cap reached: maxDeposit ${formatUnits(maxDeposit, decimals)}`);

  const plan = { vault, assets: String(amount), rawAssets: assets.toString(), previewShares: previewShares.toString() };
  if (dryRun) return { ...plan, dryRun: true };

  const wallet = createWalletClient({ account, chain: publicClient.chain, transport: http(rpcUrl) });

  const allowance = await publicClient.readContract({
    address: usdg,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, vault],
  });
  if (allowance < assets) {
    const h = await wallet.writeContract({ address: usdg, abi: erc20Abi, functionName: "approve", args: [vault, assets] });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }

  const hash = await wallet.writeContract({
    address: vault,
    abi: vaultAbi,
    functionName: "deposit",
    args: [assets, account.address],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`deposit reverted: ${hash}`);

  const shares = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [account.address] });
  const redeemable = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "convertToAssets", args: [shares] });

  return { ...plan, dryRun: false, hash, shares: shares.toString(), redeemableAssets: formatUnits(redeemable, decimals) };
}
```

Withdraw with `redeem(shares, receiver, owner)` after reading `previewRedeem`.

**Direct Morpho Blue path:**

```js
// approve morphoBlue for `assets` on the loan token first
const hash = await wallet.writeContract({
  address: addrs.morphoBlue,
  abi: morphoAbi,
  functionName: "supply",
  args: [marketParams, assets, 0n, account.address, "0x"],
});
```

Pass assets **or** shares, never both. One of the two must be zero. Morpho
reverts if both are non-zero, and supplying by shares when you meant assets is a
silent way to move the wrong amount.

### 6. Rehearse on a fork

```sh
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545
```

Impersonate a USDG holder to fund an anvil account (prompt 06, step 4), then run
deposit and redeem end to end with `dryRun: false`. Advance time to see interest
accrue:

```sh
cast rpc evm_increaseTime 86400 --rpc-url http://127.0.0.1:8545
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```

Then re-read `convertToAssets(shares)` and confirm it increased.

## Deliverable

- `lend/resolve.mjs`, `lend/verify.mjs`, `lend/discover.mjs`, `lend/rate.mjs`,
  and a deposit/withdraw module.
- `lend/DEPLOYMENTS.md` recording the Morpho Blue address, its official source
  URL, the date resolved, the `owner()` and `DOMAIN_SEPARATOR()` observed, and
  every vault you verified with its `asset()`.
- A market discovery output listing USDG markets with utilization and computed
  supply APY.
- A fork transcript showing deposit, time advance, interest accrual, and redeem.

## How to verify

1. `resolveMorpho(4663)` throws with instructions when `MORPHO_BLUE` is unset.
2. `verifyMorpho` succeeds and returns a non-zero `DOMAIN_SEPARATOR`.
3. `verifyVault` rejects a vault whose `asset()` is not the verified USDG
   address. Test it against the WETH address to confirm the rejection fires.
4. `discoverMarkets` returns at least one market, and
   `marketId(market.params)` recomputes to the `id` from the log for every entry.
   This is the check that proves your encoding is right.
5. `marketRates` returns a supply APY in a plausible range and moves when
   utilization moves on the fork.
6. On the fork, deposit increases vault share balance, `convertToAssets` rises
   after `evm_increaseTime`, and redeem returns more USDG than was deposited.
7. No Morpho address, market ID, or APY appears as a literal in source.

## Gotchas

- Morpho Blue is permissionless. Anyone can create a market with any oracle and
  any IRM, including a malicious one. A market existing says nothing about it
  being safe. Check the oracle, the IRM, and the LLTV of any market you touch,
  and prefer curated vaults whose curator you can identify.
- Market ID is `keccak256(abi.encode(marketParams))`. Field order matters. If
  your recomputed ID does not match the log, your struct order is wrong and every
  downstream call will hit the wrong market or revert.
- `supply` takes assets and shares. Exactly one must be zero.
- Reported APY is not contract state. Read the IRM. Interest accrues per second
  and `market()` returns values as of `lastUpdate`, so call `accrueInterest`
  before reading if you need current numbers rather than stale ones.
- Vault `maxDeposit` can be lower than your balance because of supply caps. Check
  it before building a transaction that will revert.
- USDG decimals are read at runtime everywhere here. Do not introduce a constant.
- ERC-4626 shares are not assets. Display `convertToAssets(shares)` to users, and
  remember redemption can be limited by available liquidity in the underlying
  markets even when the share balance is intact.
- Around 101 ms blocks means `discoverMarkets` from block 0 scans an enormous
  range. Start from the block where Morpho was deployed, which you can read off
  Blockscout, and use the chunked pattern in prompt 10.
- Lending is a spend. Testnet or fork first, always, and print the plan before
  setting `dryRun: false`.
<!-- built by nirholas x.com/nichxbt -->
