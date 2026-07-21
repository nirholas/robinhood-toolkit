<!--
  robinhood-toolkit · example readme: hello chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 01 · Hello chain

The 30-second "it works" example. Opens a read-only client against Robinhood
Chain mainnet and prints four facts that prove the connection is live: the chain
ID the node reports, the head block, the current gas price, and the node's client
version string.

Start here. If this does not run, nothing else in `examples/` will either.

## What it demonstrates

- Creating a viem public client from the `robinhoodChain` definition. The chain
  definition carries its own RPC URL, so a bare `http()` transport works.
- Asking the node for its chain ID with `getChainId()` rather than trusting the
  local constant. A mismatch means the endpoint is not the network it claims to
  be, and the program exits non-zero when it sees one.
- Reading the node's client version through `client.request()`, which is how you
  reach an RPC method outside viem's typed action surface.
- Confirming Multicall3 bytecode is actually deployed rather than trusting the
  chain definition's declaration.

## Run it

```sh
npm install          # from the repository root, once
cd examples/01-hello-chain
node index.mjs
```

Options:

```sh
node index.mjs --testnet                    # chain 46630 instead of 4663
RH_RPC=https://your.endpoint node index.mjs # your own provider
```

## Real output

Captured 2026-07-20 against `https://rpc.mainnet.chain.robinhood.com`:

```
  Robinhood Chain

  Chain ID        4663  (0x1237)
  Head block      15,016,105
  Block time      2026-07-20T21:14:27.000Z
  Gas price       0.056132 gwei
  Client          nitro/v3.11.3-rc.4-4bed0c5/linux-arm64/go1.25.12
  Explorer        https://robinhoodchain.blockscout.com
  RPC             https://rpc.mainnet.chain.robinhood.com
  Transfer cost   0.000001178772 ETH  (21,000 gas)
  Multicall3      deployed at 0xcA11bde05977b3631167028862bE2a173976CA11

  At approximately 101 ms per block that is about 855,446 blocks per day.
```

Block height and gas price move. Chain ID, client string, and the Multicall3
address should not.

## Notes

**855,000 blocks per day.** At roughly 101 ms per block this chain produces about
two orders of magnitude more blocks per day than a 12-second L1. Every range
constant you carry over from Ethereum mainnet is wrong here, usually by 100x. See
[example 04](../04-log-scanner/) for what that does to log scanning.

**Multicall3 is declared on the chain definition.** viem's `multicall()` throws
`ChainDoesNotSupportContract` without it, before sending anything, and does not
fall back to individual calls. `robinhood-chain` declares it on both networks;
this example verifies the bytecode is really there.

## Read-only

No key, no signing, no spend. Every call is an `eth_` read.
