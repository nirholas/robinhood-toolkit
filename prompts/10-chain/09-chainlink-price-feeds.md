<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · build prompt: Chainlink price feeds on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 09 · Consume Chainlink price feeds

## Goal

Read a Chainlink price feed on Robinhood Chain from both Solidity and viem, with
the feed address resolved from Chainlink's official feed directory rather than
pasted from anywhere else, and with staleness and sanity guards that make a bad
answer fail closed instead of pricing a trade wrong.

## Prerequisites

- Prompts 02 (Foundry) and 04 (viem chain definitions) completed.
- Node.js 20 with `viem`. Foundry for the Solidity consumer and its fork test.

## Reference facts (verified)

- Chainlink is the official oracle on Robinhood Chain.
- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com` (Blockscout).
- Testnet: chain ID `46630`, RPC `https://rpc.testnet.chain.robinhood.com`.
- Arbitrum Orbit (Nitro), fully EVM compatible, so `AggregatorV3Interface` and
  the standard Chainlink consumer pattern work unmodified.
- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` and USDG
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` are the confirmed token anchors on
  this chain.
- Around 101 ms blocks. Do not use block count as a proxy for elapsed time when
  reasoning about feed freshness.

**UNVERIFIED and must be resolved by you:** which Chainlink feeds exist on chain
4663, their proxy addresses, their decimals, and their heartbeat and deviation
thresholds. None of that is carried in this toolkit. Resolve it in step 1. A
feed address that did not come from Chainlink's own directory is not a feed
address.

## Steps

### 1. Resolve the feed from Chainlink's directory

Sources, in order:

1. The Chainlink Data Feeds address pages at <https://docs.chain.link/data-feeds/price-feeds/addresses>,
   filtered to the Robinhood Chain network. Record the **proxy** address, the
   decimals, the heartbeat, and the deviation threshold for each feed you use.
2. Chainlink's machine-readable reference data directory, if it publishes a JSON
   file for this network. Whether it does is UNVERIFIED. Test the URL before
   depending on it, and fall back to the docs page if it 404s.
3. Blockscout on chain 4663, to confirm the address has verified source and
   behaves like an aggregator proxy.

The Chainlink Feed Registry (`FeedRegistryInterface`) is a separate contract and
is not deployed on every chain. Do not assume it exists here. Resolve feeds by
address.

`oracle/resolve.mjs`:

```js
/**
 * robinhood-toolkit · resolve Chainlink feed addresses for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { getAddress, isAddress } from "viem";

/**
 * Feeds are supplied by environment, one variable per pair, after you confirm
 * each address on https://docs.chain.link/data-feeds/price-feeds/addresses.
 * Format: CHAINLINK_FEED_ETH_USD=0x...
 */
export function feedAddress(pair) {
  const key = `CHAINLINK_FEED_${pair.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `${key} is not set. Resolve the ${pair} feed proxy address for chain 4663 from ` +
        "https://docs.chain.link/data-feeds/price-feeds/addresses and record its " +
        "decimals, heartbeat, and deviation threshold in oracle/FEEDS.md.",
    );
  }
  if (!isAddress(value)) throw new Error(`${key} is not a valid address: ${value}`);
  return getAddress(value);
}

/**
 * Heartbeat in seconds, from the Chainlink docs for that specific feed.
 * There is no safe default, so this throws rather than guessing.
 */
export function feedHeartbeat(pair) {
  const key = `CHAINLINK_HEARTBEAT_${pair.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const value = Number(process.env[key]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} is not set. Read the heartbeat for ${pair} from the Chainlink feed page.`);
  }
  return value;
}
```

If the directory JSON exists for this network, add a fetch-and-cache loader that
populates the same interface. Keep env as the override.

### 2. Read the feed with viem, with guards

`oracle/read.mjs`:

```js
/**
 * robinhood-toolkit · Chainlink feed reader with staleness guards
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { formatUnits, parseAbi } from "viem";
import { feedAddress, feedHeartbeat } from "./resolve.mjs";

export const aggregatorV3Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function version() view returns (uint256)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function aggregator() view returns (address)",
]);

export class StalePriceError extends Error {
  constructor(message) {
    super(message);
    this.name = "StalePriceError";
  }
}

export async function describeFeed(client, address) {
  const [decimals, description, version, code] = await Promise.all([
    client.readContract({ address, abi: aggregatorV3Abi, functionName: "decimals" }),
    client.readContract({ address, abi: aggregatorV3Abi, functionName: "description" }),
    client.readContract({ address, abi: aggregatorV3Abi, functionName: "version" }),
    client.getBytecode({ address }),
  ]);
  if (!code || code === "0x") throw new Error(`feed ${address} has no bytecode on this chain`);
  return { address, decimals, description, version: version.toString() };
}

/**
 * Read a price and refuse to return one that is stale, non-positive, or from an
 * incomplete round. `graceSeconds` absorbs normal jitter around the heartbeat.
 */
export async function readPrice(client, pair, { graceSeconds = 60, maxAgeSeconds } = {}) {
  const address = feedAddress(pair);
  const heartbeat = maxAgeSeconds ?? feedHeartbeat(pair);
  const meta = await describeFeed(client, address);

  const [roundId, answer, startedAt, updatedAt, answeredInRound] = await client.readContract({
    address,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
  });

  if (answer <= 0n) throw new StalePriceError(`${pair} answer is not positive: ${answer}`);
  if (updatedAt === 0n) throw new StalePriceError(`${pair} round ${roundId} is incomplete`);
  if (answeredInRound < roundId) throw new StalePriceError(`${pair} answer is from a previous round`);

  // Use wall clock against the feed's own timestamp. Do not derive age from
  // block numbers: blocks are around 101 ms here and that ratio is not stable.
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const age = nowSeconds - updatedAt;
  if (age > BigInt(heartbeat + graceSeconds)) {
    throw new StalePriceError(`${pair} is stale: ${age}s old, heartbeat ${heartbeat}s`);
  }

  return {
    pair,
    feed: address,
    description: meta.description,
    decimals: meta.decimals,
    answer,
    price: Number(formatUnits(answer, meta.decimals)),
    roundId: roundId.toString(),
    updatedAt: Number(updatedAt),
    ageSeconds: Number(age),
  };
}
```

Run it:

```sh
CHAINLINK_FEED_ETH_USD=0x... CHAINLINK_HEARTBEAT_ETH_USD=3600 node -e '
import("./oracle/read.mjs").then(async (m) => {
  const { createPublicClient, http } = await import("viem");
  const { robinhoodMainnet } = await import("./clients/token.mjs");
  const client = createPublicClient({ chain: robinhoodMainnet, transport: http() });
  console.log(await m.readPrice(client, "ETH_USD"));
});'
```

### 3. The Solidity consumer

`src/PriceConsumer.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// robinhood-toolkit · Chainlink consumer with staleness guards
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
contract PriceConsumer {
    AggregatorV3Interface public immutable feed;
    uint256 public immutable maxAge;
    uint8 public immutable feedDecimals;

    error StalePrice(uint256 updatedAt, uint256 nowTs, uint256 maxAge);
    error InvalidPrice(int256 answer);
    error IncompleteRound(uint80 roundId, uint80 answeredInRound);
    error ZeroAddress();

    /// @param feed_ the Chainlink PROXY address for the pair, from the official directory
    /// @param maxAge_ the feed's heartbeat in seconds plus your grace margin
    constructor(address feed_, uint256 maxAge_) {
        if (feed_ == address(0)) revert ZeroAddress();
        feed = AggregatorV3Interface(feed_);
        maxAge = maxAge_;
        feedDecimals = AggregatorV3Interface(feed_).decimals();
    }

    /// @return price the latest answer, scaled to feedDecimals
    function latestPrice() public view returns (int256 price) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt == 0 || answeredInRound < roundId) revert IncompleteRound(roundId, answeredInRound);
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxAge) {
            revert StalePrice(updatedAt, block.timestamp, maxAge);
        }
        return answer;
    }

    /// @notice Value `amount` of an 18-decimal asset in feed quote units, scaled to 18 decimals.
    function valueOf(uint256 amount) external view returns (uint256) {
        int256 price = latestPrice();
        return (amount * uint256(price)) / (10 ** feedDecimals);
    }
}
```

`feedDecimals` is read from the feed in the constructor rather than passed in,
which removes an entire class of scaling bug.

### 4. Fork test against the live feed

`test/PriceConsumer.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PriceConsumer, AggregatorV3Interface} from "../src/PriceConsumer.sol";

/// robinhood-toolkit · PriceConsumer fork tests
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
contract PriceConsumerForkTest is Test {
    PriceConsumer internal consumer;
    address internal feedAddr;

    function setUp() public {
        // Skips cleanly when the feed address is not configured.
        feedAddr = vm.envOr("CHAINLINK_FEED_ETH_USD", address(0));
        if (feedAddr == address(0)) return;
        vm.createSelectFork(vm.rpcUrl("rh_mainnet"));
        consumer = new PriceConsumer(feedAddr, vm.envOr("CHAINLINK_HEARTBEAT_ETH_USD", uint256(3600)) + 300);
    }

    function test_ReadsLivePrice() public view {
        if (feedAddr == address(0)) return;
        int256 price = consumer.latestPrice();
        assertGt(price, 0);
        assertGt(consumer.feedDecimals(), 0);
    }

    function test_RevertWhen_Stale() public {
        if (feedAddr == address(0)) return;
        // Push wall clock far past any plausible heartbeat.
        vm.warp(block.timestamp + 365 days);
        vm.expectRevert();
        consumer.latestPrice();
    }

    function test_RevertWhen_NegativeAnswer() public {
        if (feedAddr == address(0)) return;
        vm.mockCall(
            feedAddr,
            abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
            abi.encode(uint80(1), int256(-1), uint256(block.timestamp), uint256(block.timestamp), uint80(1))
        );
        vm.expectRevert(abi.encodeWithSelector(PriceConsumer.InvalidPrice.selector, int256(-1)));
        consumer.latestPrice();
    }
}
```

```sh
source .env
forge test --match-contract PriceConsumerForkTest -vv
```

### 5. Deploy the consumer

```sh
forge create src/PriceConsumer.sol:PriceConsumer \
  --rpc-url rh_testnet --account "$RH_ACCOUNT" \
  --constructor-args "$CHAINLINK_FEED_ETH_USD" 3900 \
  --broadcast

cast call <deployed> 'latestPrice()(int256)' --rpc-url rh_testnet
cast call <deployed> 'feedDecimals()(uint8)' --rpc-url rh_testnet
```

Deploy to testnet only if a feed exists on 46630. If it does not, run the fork
test against mainnet instead and deploy the consumer to mainnet once its guards
are proven.

## Deliverable

- `oracle/resolve.mjs` and `oracle/read.mjs`.
- `src/PriceConsumer.sol` and `test/PriceConsumer.t.sol`.
- `oracle/FEEDS.md`: one row per feed with pair, proxy address, decimals,
  heartbeat, deviation threshold, the Chainlink docs URL it came from, and the
  date resolved.
- `.env.example` with `CHAINLINK_FEED_*` and `CHAINLINK_HEARTBEAT_*` entries.

## How to verify

1. `feedAddress("ETH_USD")` throws with instructions when unset.
2. `describeFeed` returns a `description` that matches the pair you expect. A
   description of a different pair means you resolved the wrong address.
3. `readPrice` returns a plausible price with `ageSeconds` below the heartbeat.
4. Setting `maxAgeSeconds: 1` makes `readPrice` throw `StalePriceError`, proving
   the guard is live and not decorative.
5. `forge test --match-contract PriceConsumerForkTest -vv` passes, including the
   staleness revert and the negative-answer revert.
6. `valueOf(1e18)` returns a value consistent with the price times one unit,
   which confirms the decimal scaling.
7. No feed address appears as a literal in any source file.

## Gotchas

- Always consume the **proxy** address from the directory, never the underlying
  aggregator. `aggregator()` changes when a feed is upgraded, and a cached
  aggregator address silently freezes at an old implementation.
- Feed decimals vary per feed. USD pairs are commonly 8 and ETH pairs commonly
  18, but read `decimals()` rather than relying on that.
- `latestRoundData` returning successfully is not the same as the answer being
  fresh. Unguarded consumption of a stale oracle is one of the most common
  causes of real DeFi losses. All four guards in `latestPrice` are load bearing:
  positive answer, complete round, `answeredInRound >= roundId`, and age.
- `maxAge` must come from that feed's documented heartbeat plus a margin. There
  is no universal value, which is why `feedHeartbeat` throws rather than
  defaulting.
- Do not convert block numbers into elapsed time. Around 101 ms blocks make that
  arithmetic wrong quickly. Use `block.timestamp` on chain and wall clock off
  chain.
- Chainlink Price Feeds, Data Streams, Functions, and CCIP are different
  products with different interfaces. `AggregatorV3Interface` applies to Price
  Feeds only.
- A Chainlink equity feed prices the underlying equity. A Stock Token is a
  tokenized debt security whose market price on this chain can diverge from it.
  Do not treat an equity feed as an authoritative price for the token itself
  without saying so explicitly in your product copy.
- Equity feeds may have market-hours behavior while Stock Tokens trade 24/7.
  Whether the feeds you resolved update outside US market hours is UNVERIFIED.
  Check the feed page, and design for the answer, because a weekend-stale equity
  feed will trip your staleness guard by design.
<!-- built by nirholas x.com/nichxbt -->
