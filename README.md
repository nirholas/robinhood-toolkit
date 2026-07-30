<!--
  robinhood-toolkit · project readme
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

<h1 align="center">robinhood-toolkit</h1>

<p align="center"><strong>Build on Robinhood Chain and Robinhood Crypto. Tools, runnable examples, and 64 build prompts.</strong></p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="prompts/">Build prompts</a> ·
  <a href="examples/">Examples</a> ·
  <a href="#network-parameters">Networks</a> ·
  <a href="#deploy">Deploy</a>
</p>

---

Robinhood opened up to developers on two fronts: **Robinhood Chain**, an
Arbitrum Orbit L2 that went to public mainnet on 2026-07-01 with permissionless
contract deploys, and the **Robinhood Crypto REST API** for programmatic
trading. A third front, agentic trading over MCP, currently covers equities and
options with crypto support announced as rolling out.

This repository is the practical layer on top of all three: network constants
you can trust, code that runs as written, and a prompt library you can hand to a
coding agent to build any piece of it.

## Why this exists

The official documentation tells you what the endpoints are. It does not tell
you how to wire a datafeed into a candlestick chart, how to structure a strategy
loop that will not liquidate you at 4am on a 24/7 venue, or how to get the same
codebase onto five different hosts. That gap is what this fills.

Every fact here was verified against a live source. Network parameters were
confirmed by direct RPC calls rather than copied from documentation. Anything
that could not be verified is labeled `UNVERIFIED` inline with instructions for
checking it yourself.

## Network parameters

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `4663` | `46630` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |
| Faucet | n/a | [faucet.testnet.chain.robinhood.com](https://faucet.testnet.chain.robinhood.com) |

Stack: Arbitrum Orbit (Nitro), settles to Ethereum, Ethereum blobs for data
availability. Observed ~101ms block times and ~0.055 gwei gas. Solidity and
Vyper deploy unmodified; deployment is permissionless.

Core contracts: WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` ·
USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

## Quick start

```sh
git clone https://github.com/nirholas/robinhood-toolkit
cd robinhood-toolkit
npm install
```

Confirm you can reach the chain:

```sh
cast chain-id --rpc-url https://rpc.mainnet.chain.robinhood.com
# 4663
```

Or without Foundry:

```sh
curl -s https://rpc.mainnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":"0x1237"}
```

Then pick a track from [`prompts/`](prompts/).

## Packages

| Package | Install | What it is |
|---|---|---|
| [`robinhood-chain`](packages/robinhood-chain/) | `npm i robinhood-chain viem` | The chain SDK: viem chain definitions with Multicall3 declared, verified token constants, formatting that never guesses decimals, on-chain address verification against ticker collisions, and adaptive `eth_getLogs` scanning |
| [`robinhood-chain-mcp`](packages/robinhood-chain-mcp/) | `npx robinhood-chain-mcp` | Read-only MCP server. Gives Claude Code, Claude Desktop, Cursor, or any MCP host the ability to read Robinhood Chain: network status, balances, token metadata, transactions, DEX pairs, and an anti-scam token address verifier. Holds no keys and cannot sign or send |

Connect the MCP server to an agent in one command:

```sh
claude mcp add robinhood-chain -- npx -y robinhood-chain-mcp
```

Reach for `robinhood-chain` before hand-rolling constants. It encodes the traps
that cost the most time here: USDG has **6** decimals rather than 18, two live
tokens on mainnet both answer to the symbol `USDG`, viem's `multicall()` throws
outright without a `contracts.multicall3` entry, and `eth_getLogs` enforces two
independent caps of which one misreports itself as a parameter error.

## Build prompts

64 self-contained build tasks across nine tracks. Each states its goal,
prerequisites, verified reference facts, steps, deliverable, and verification
procedure. Hand one to a coding agent or work it yourself.

| Track | Files | Covers |
|---|---|---|
| [00-foundations](prompts/00-foundations/) | 6 | Network setup, wallets, bridging, trust assumptions |
| [10-chain](prompts/10-chain/) | 10 | Contract deploys, Stock Tokens, Uniswap, Morpho, Chainlink, indexing |
| [20-crypto-api](prompts/20-crypto-api/) | 8 | REST API auth, market data, orders, streams |
| [30-agentic-mcp](prompts/30-agentic-mcp/) | 7 | Connecting agents, enumerating tools, adapters |
| [40-charting](prompts/40-charting/) | 8 | DexScreener data, TradingView charts, custom datafeeds |
| [50-autonomous](prompts/50-autonomous/) | 8 | Strategy loops, backtesting, paper mode, execution |
| [60-site](prompts/60-site/) | 6 | The documentation site |
| [70-deploy](prompts/70-deploy/) | 6 | Cloudflare, Vercel, Railway, Cloud Run, GitHub Pages |
| [80-safety](prompts/80-safety/) | 5 | Keys, guardrails, simulation, audit logs, incidents |

## Deploy

The site in [`site/`](site/) is a single codebase that deploys to Cloudflare
Pages, Vercel, Railway, Google Cloud Run, and GitHub Pages. See
[prompts/70-deploy](prompts/70-deploy/) for the config each target needs and the
one gotcha that breaks a naive port between them.

## Things worth knowing before you build

**The chain is centralized today.** Robinhood operates both the sequencer and
the proposer, and [L2BEAT](https://l2beat.com/scaling/projects/robinhood) rates
its risk profile accordingly because fewer than five external actors can submit
fraud challenges. That is a normal place for a young L2 to be, and it is also a
real trust assumption. Size positions with it in mind.

**Canonical bridge withdrawals take about 7 days.** That is the standard
optimistic challenge period, not a bug. Partner routes (LayerZero, Chainlink
CCIP, Relay, Across, LiFi) exit faster for a fee.

**Bridged token addresses differ from their Ethereum counterparts.** Resolve
addresses on the chain you are actually on.

**Stock Token addresses come from a live registry.** They are tokenized debt
securities issued by Robinhood Assets (Jersey) Limited that grant no legal or
beneficial rights in the underlying. Robinhood warns explicitly that a token
matching a ticker at a different address is not canonical. Query the registry at
runtime; never hardcode.

**On-chain balances are not brokerage balances.** Self-custody wallet services
run through Robinhood Non-Custodial, Ltd., a separate legal entity from
Robinhood Financial LLC and Robinhood Crypto, LLC. Same company, deliberately
integrated product, distinct custody.

**Nobody is supervising your agent.** Robinhood states it does not control,
supervise, monitor, recommend, or audit connected agents. Read
[prompts/80-safety](prompts/80-safety/) before anything of yours places an order
unattended.

## Contributing

Issues and PRs welcome. Two rules: every code sample must run as written, and
no invented addresses, endpoints, or API shapes. If you cannot verify it, label
it `UNVERIFIED` and say how the reader can check.

Source files carry an authorship header. See [ATTRIBUTION.md](ATTRIBUTION.md).

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. or any
of its subsidiaries. "Robinhood" is used nominatively to identify the platforms
this toolkit targets.

Nothing here is financial advice. Trading crypto carries risk of total loss.
Autonomous trading software can lose money faster than you can react to it. You
are responsible for anything your code does with your funds.

## License

All Rights Reserved © 2026 [nirholas](https://github.com/nirholas). See [LICENSE](LICENSE).

## Documentation

Full documentation site: **https://nirholas.github.io/robinhood-toolkit/**

- [Getting started](docs/getting-started.md) covers install and first run.
- [Examples](docs/examples.md) has copy-paste snippets.
