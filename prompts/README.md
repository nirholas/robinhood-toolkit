<!--
  robinhood-toolkit · prompt index
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: MIT (c) 2026 nirholas
-->

# Build prompts

Each file here is a self-contained, actionable build task. Hand one to a coding
agent or work it yourself. Every prompt states its goal, prerequisites, verified
reference facts, the exact deliverable, and how to verify the result.

Facts in these prompts were verified against live sources on 2026-07-20. Network
parameters were confirmed by direct RPC calls, not copied from documentation.
Where a fact could not be verified it is labeled UNVERIFIED inline.

## Verified constants

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- Stack: Arbitrum Orbit (Nitro), settles to Ethereum, blob DA. Mainnet live 2026-07-01.
- WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` · USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- Docs: <https://docs.robinhood.com/chain/> · Crypto REST API: <https://docs.robinhood.com/crypto/trading>
- Agentic MCP: `https://agent.robinhood.com/mcp/trading` (equities/options today, crypto rollout announced)

## Tracks

| Track | Files | Covers |
|---|---|---|
| [00-foundations](00-foundations/) | 6 | Network setup, wallets, bridging, trust assumptions |
| [10-chain](10-chain/) | 10 | Contract deploys, Stock Tokens, Uniswap, Morpho, Chainlink, indexing |
| [20-crypto-api](20-crypto-api/) | 8 | Robinhood Crypto REST API: auth, market data, orders, streams |
| [30-agentic-mcp](30-agentic-mcp/) | 7 | Connecting agents, enumerating tools, building adapters |
| [40-charting](40-charting/) | 8 | DexScreener data, TradingView charts, custom datafeeds |
| [50-autonomous](50-autonomous/) | 8 | Strategy loops, backtesting, paper mode, execution, scheduling |
| [60-site](60-site/) | 6 | The monochrome tutorial site |
| [70-deploy](70-deploy/) | 6 | Cloudflare, Vercel, Railway, Cloud Run, GitHub Pages |
| [80-safety](80-safety/) | 5 | Keys, policy guardrails, simulation, audit logs, incidents |

64 prompts total.

## Ground rules for every prompt

1. No fabricated addresses, endpoints, or API shapes. Query registries at runtime.
2. Every code sample must run as written.
3. Testnet first for anything that spends.
4. Attribution header on every file created ([ATTRIBUTION.md](../ATTRIBUTION.md)).
5. State trust assumptions honestly. This chain has a centralized sequencer and
   proposer; say so where it matters rather than omitting it.
