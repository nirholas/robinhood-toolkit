<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: USDG transfers on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 06 · Move USDG safely

## Goal

Build a USDG transfer module that reads decimals at runtime, never parses an
amount with a hardcoded exponent, rehearses every spend on a forked chain before
touching mainnet, and confirms the resulting balance delta. USDG is the
settlement asset for Stock Tokens, so this is the money path for everything in
this track.

## Prerequisites

- Prompt 02 (Foundry aliases) and prompt 04 (viem chain definitions in
  `clients/token.mjs`) completed.
- Node.js 20 with `viem`.
- Anvil (ships with Foundry) for the fork rehearsal.
- A funded EOA. For the mainnet section, an account holding USDG.

## Reference facts (verified)

- USDG on mainnet: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. It is a
  **proxy** with confirmed on-chain bytecode.
- WETH on mainnet: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, also a proxy.
- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com`.
- Testnet: chain ID `46630`, RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com`.
- Gas is paid in ETH, not USDG, around 0.055 gwei. Around 101 ms blocks.
- Stock Tokens settle in USDG (prompt 05).
- Docs: <https://docs.robinhood.com/chain/contracts/>.

**UNVERIFIED:** whether USDG exists on testnet 46630, and at what address. The
address above is confirmed on mainnet only. Do not assume the same address on
testnet. Resolve it from <https://docs.robinhood.com/chain/contracts/> or the
testnet explorer, and if there is no testnet deployment, use the anvil fork
rehearsal in step 4 instead of skipping the dry run.

**UNVERIFIED:** USDG's decimals. Read them on-chain (step 1). Do not assume 6 or
18 because of what other dollar stablecoins do.

## Steps

### 1. Read the token before you touch it

```sh
export RH_MAINNET_RPC=https://rpc.mainnet.chain.robinhood.com
export USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168

cast call "$USDG" 'symbol()(string)'      --rpc-url "$RH_MAINNET_RPC"
cast call "$USDG" 'name()(string)'        --rpc-url "$RH_MAINNET_RPC"
cast call "$USDG" 'decimals()(uint8)'     --rpc-url "$RH_MAINNET_RPC"
cast call "$USDG" 'totalSupply()(uint256)' --rpc-url "$RH_MAINNET_RPC"
```

Write the observed decimals into your notes. Every amount conversion in the rest
of this prompt uses the value read here, at runtime, not the value you saw once.

### 2. Confirm the proxy and inspect the implementation

USDG is a proxy. Read the EIP-1967 implementation and admin slots:

```sh
# implementation slot: keccak256("eip1967.proxy.implementation") - 1
cast storage "$USDG" \
  0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc \
  --rpc-url "$RH_MAINNET_RPC"

# admin slot: keccak256("eip1967.proxy.admin") - 1
cast storage "$USDG" \
  0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103 \
  --rpc-url "$RH_MAINNET_RPC"
```

A non-zero implementation slot confirms EIP-1967. A zero value means a different
proxy pattern (beacon, custom), in which case read the implementation from the
explorer's proxy tab at
`https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.

Record what the implementation exposes beyond plain ERC-20. Regulated dollar
tokens commonly have pause, freeze, blocklist, or forced-transfer functions.
Whether USDG has any of these is UNVERIFIED here. Check the verified source on
the explorer and note the answer, because it determines whether a transfer can
fail for reasons unrelated to balance.

```sh
cast interface "$USDG" --rpc-url "$RH_MAINNET_RPC" 2>/dev/null || \
  echo "fetch the ABI from the explorer proxy tab instead"
```

### 3. The transfer module

`clients/usdg.mjs`:

```js
/**
 * robinhood-toolkit · USDG transfers on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, getAddress, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodMainnet, robinhoodTestnet } from "./token.mjs";

export const USDG_MAINNET = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");

/**
 * USDG on testnet is not verified. Supply RH_USDG_TESTNET after confirming the
 * address from https://docs.robinhood.com/chain/contracts/ or the testnet explorer.
 */
export function usdgAddress(chainId) {
  if (chainId === 4663) return USDG_MAINNET;
  if (chainId === 46630) {
    const a = process.env.RH_USDG_TESTNET;
    if (!a) throw new Error("RH_USDG_TESTNET is not set and the testnet USDG address is not verified");
    return getAddress(a);
  }
  throw new Error(`unsupported chainId ${chainId}`);
}

export function publicClientFor(chainId, rpcUrl) {
  const chain = chainId === 4663 ? robinhoodMainnet : robinhoodTestnet;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/** Read decimals every time. Never hardcode the exponent. */
export async function usdgMeta(client) {
  const address = usdgAddress(await client.getChainId());
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, symbol, decimals };
}

export async function usdgBalance(client, holder) {
  const { address, decimals, symbol } = await usdgMeta(client);
  const raw = await client.readContract({
    address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [getAddress(holder)],
  });
  return { raw, formatted: formatUnits(raw, decimals), decimals, symbol, token: address };
}

/**
 * Transfer USDG. `amount` is a decimal string such as "12.50", parsed with the
 * decimals read from the contract at call time.
 */
export async function transferUsdg({ rpcUrl, chainId, privateKey, to, amount, dryRun = true }) {
  const publicClient = publicClientFor(chainId, rpcUrl);
  const onchainChainId = await publicClient.getChainId();
  if (onchainChainId !== chainId) {
    throw new Error(`RPC reports chainId ${onchainChainId}, expected ${chainId}`);
  }

  const account = privateKeyToAccount(privateKey);
  const recipient = getAddress(to);
  const { address, decimals, symbol } = await usdgMeta(publicClient);
  const value = parseUnits(String(amount), decimals);
  if (value <= 0n) throw new Error("amount must be greater than zero");

  const before = await usdgBalance(publicClient, account.address);
  if (before.raw < value) {
    throw new Error(`insufficient ${symbol}: have ${before.formatted}, need ${amount}`);
  }

  const gas = await publicClient.estimateContractGas({
    address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, value],
    account,
  });

  const plan = {
    chainId,
    token: address,
    symbol,
    decimals,
    from: account.address,
    to: recipient,
    amount: String(amount),
    rawAmount: value.toString(),
    balanceBefore: before.formatted,
    estimatedGas: gas.toString(),
  };

  if (dryRun) return { ...plan, dryRun: true };

  const walletClient = createWalletClient({
    account,
    chain: publicClient.chain,
    transport: http(rpcUrl),
  });
  const hash = await walletClient.writeContract({
    address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, value],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`transfer reverted: ${hash}`);

  const after = await usdgBalance(publicClient, account.address);
  const recipientAfter = await usdgBalance(publicClient, recipient);

  return {
    ...plan,
    dryRun: false,
    hash,
    gasUsed: receipt.gasUsed.toString(),
    balanceAfter: after.formatted,
    senderDelta: formatUnits(before.raw - after.raw, decimals),
    recipientBalance: recipientAfter.formatted,
  };
}
```

The default is `dryRun: true`. A caller must opt into spending explicitly.

### 4. Rehearse on a fork before spending anything real

Fork mainnet locally. This costs nothing and exercises the real USDG
implementation, including any pause or blocklist logic.

```sh
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545
```

In a second shell, give an anvil test account USDG by impersonating a holder
found on the explorer's token holders page:

```sh
export LOCAL=http://127.0.0.1:8545
export USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
export WHALE=<a holder address from the explorer token holders tab>
export ME=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266   # anvil account 0

cast rpc anvil_impersonateAccount "$WHALE" --rpc-url "$LOCAL"
cast rpc anvil_setBalance "$WHALE" 0xde0b6b3a7640000 --rpc-url "$LOCAL"

DEC=$(cast call "$USDG" 'decimals()(uint8)' --rpc-url "$LOCAL")
AMT=$(python3 -c "print(10 * 10**$DEC)")

cast send "$USDG" 'transfer(address,uint256)' "$ME" "$AMT" \
  --from "$WHALE" --unlocked --rpc-url "$LOCAL"

cast call "$USDG" 'balanceOf(address)(uint256)' "$ME" --rpc-url "$LOCAL"
```

Now run the module against the fork with `dryRun: false`. The chain ID is 4663
and the code path is identical to mainnet, but no real funds move.

```sh
node -e '
import("./clients/usdg.mjs").then(async (m) => {
  console.log(await m.transferUsdg({
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 4663,
    privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    amount: "1.5",
    dryRun: false,
  }));
});'
```

### 5. Mainnet, with the plan printed first

```sh
node -e '
import("./clients/usdg.mjs").then(async (m) => {
  const plan = await m.transferUsdg({
    rpcUrl: process.env.RH_MAINNET_RPC,
    chainId: 4663,
    privateKey: process.env.RH_PRIVATE_KEY,
    to: process.env.RECIPIENT,
    amount: process.env.AMOUNT,
    dryRun: true,
  });
  console.log(plan);
});'
```

Read the plan. Confirm token address, recipient, decimals, and raw amount. Only
then rerun with `dryRun: false`.

The equivalent one-liner with cast, where the amount is computed from on-chain
decimals rather than typed:

```sh
DEC=$(cast call "$USDG" 'decimals()(uint8)' --rpc-url "$RH_MAINNET_RPC")
AMT=$(python3 -c "from decimal import Decimal; print(int(Decimal('25') * 10**$DEC))")
cast send "$USDG" 'transfer(address,uint256)' "$RECIPIENT" "$AMT" \
  --rpc-url "$RH_MAINNET_RPC" --account rh-deployer
```

### 6. Approvals, when a contract will pull USDG

```sh
cast call "$USDG" 'allowance(address,address)(uint256)' "$ME" "$SPENDER" --rpc-url "$RH_MAINNET_RPC"
cast send "$USDG" 'approve(address,uint256)' "$SPENDER" "$AMT" --rpc-url "$RH_MAINNET_RPC" --account rh-deployer
```

Approve the exact amount needed. Do not approve `type(uint256).max` to a
contract you did not deploy and have not read.

## Deliverable

- `clients/usdg.mjs` with `usdgMeta`, `usdgBalance`, and `transferUsdg`
  defaulting to dry run.
- `USDG.md` recording: the mainnet address, observed `symbol`, observed
  `decimals`, the EIP-1967 implementation address and the date read, and whether
  the implementation exposes pause, freeze, blocklist, or forced transfer.
- A fork rehearsal transcript showing a successful transfer at chain ID 4663
  against anvil.
- A `.gitignore` that excludes any file holding a private key.

## How to verify

1. `usdgMeta` returns decimals read from chain, and no literal exponent appears
   anywhere in your source (`grep -n '10 \*\* 6\|1e6\|1e18' clients/usdg.mjs`
   returns nothing).
2. On the fork, sender balance drops by exactly the transferred amount and
   recipient balance rises by the same, confirmed by `usdgBalance` before and
   after.
3. `transferUsdg` with an amount above your balance throws before broadcasting,
   not after.
4. A wrong `chainId` argument throws on the RPC mismatch check. Test it by
   passing `chainId: 46630` with the mainnet RPC.
5. The receipt has `status === "success"` and `Transfer(from,to,value)` in its
   logs with the raw amount you computed.
6. `cast call` balance reads agree with what the module reports.

## Gotchas

- **Never hardcode decimals.** USDG's decimals are read at runtime in every
  function above for exactly this reason. A wrong exponent sends 10^12 times the
  intended amount or reverts confusingly.
- **USDG is a proxy.** Interact through `0x5fc5...d168` only. The implementation
  address can change, so never cache it or send to it.
- Regulated dollar tokens frequently have transfer restrictions. A revert with no
  clear reason may be a pause or blocklist, not a balance problem. Read the
  verified implementation source on Blockscout before debugging blind.
- Gas is ETH, not USDG. An account with plenty of USDG and zero ETH cannot move
  anything.
- Around 101 ms blocks means `waitForTransactionReceipt` returns almost
  immediately. That is sequencer confirmation on an Orbit L2 with a centralized
  sequencer, not Ethereum settlement. For large transfers, define what finality
  you require and wait for it deliberately.
- `transfer` to a contract that cannot handle ERC-20 balances burns the funds
  permanently. Validate the recipient. Sending USDG to the USDG contract itself
  is the classic version of this mistake.
- The testnet USDG address is not verified. Do not copy the mainnet address to
  testnet and assume it works. The fork rehearsal is the reliable dry run.
- Do not approve unlimited allowance by reflex. Exact amounts, revoked after use.
<!-- built by nirholas x.com/nichxbt -->
