<!--
  robinhood-toolkit · robinhood-chain-mcp package readme
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# robinhood-chain-mcp

**Read-only MCP server for Robinhood Chain.** Gives any AI agent (Claude Code,
Claude Desktop, Cursor, ChatGPT, or anything else speaking the Model Context
Protocol) the ability to query Robinhood Chain: network status, ETH and ERC-20
balances, token metadata, transactions, DEX pairs, and arbitrary view functions.

Includes `verify_token_address`, an anti-scam check built for a collision that
is live on this chain right now.

---

## Read-only by design

**This server never holds a private key, never signs, and never sends a
transaction.** That is an architectural boundary, not a setting:

- There is no signing code path anywhere in the package. No wallet client is
  constructed, no key material is read from the environment, no transaction is
  ever built.
- The only chain dependency is viem's **public** client. `viem/accounts`,
  `createWalletClient`, `privateKeyToAccount`, and every equivalent are never
  imported. The test suite asserts this on every run.
- `read_contract` inspects the ABI fragment you give it and **refuses** any
  function that is not `view` or `pure`, because a state-changing call would
  require a transaction this server cannot produce.
- No tool accepts a key, seed, or amount-to-send parameter. A test enforces that
  too.

There is no configuration flag that turns writes on. If you want an agent that
can transact, that belongs in a separate server with its own confirmation gates,
so that connecting a read tool never widens your blast radius.

## Install

Requires Node 20 or newer. No API key, no signup, no account.

```sh
npx robinhood-chain-mcp
```

That is the whole install. The command below is only needed if you want it
resident:

```sh
npm install -g robinhood-chain-mcp
```

## Connect it to your agent

### Claude Code

```sh
claude mcp add robinhood-chain -- npx -y robinhood-chain-mcp
```

Then ask it something. `/mcp` lists the connected server and its tools.

### Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "robinhood-chain": {
      "command": "npx",
      "args": ["-y", "robinhood-chain-mcp"]
    }
  }
}
```

Restart Claude Desktop.

### Cursor

Edit `~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` for one:

```json
{
  "mcpServers": {
    "robinhood-chain": {
      "command": "npx",
      "args": ["-y", "robinhood-chain-mcp"]
    }
  }
}
```

### Any other MCP host

Standard stdio transport. Run `npx -y robinhood-chain-mcp` and speak JSON-RPC on
stdin and stdout.

## Configuration

Both variables are optional. With neither set, the server uses the public
endpoints and works out of the box.

| Variable | Purpose |
|---|---|
| `ROBINHOOD_MAINNET_RPC_URL` | Override the mainnet RPC (chain 4663) with your own provider. |
| `ROBINHOOD_TESTNET_RPC_URL` | Override the testnet RPC (chain 46630) with your own provider. |

Set one if you are making sustained requests and want a rate limit that is
contractual rather than discovered in production. The public endpoints' limits
are not documented.

## Networks

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | `4663` | `46630` |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) |
| Gas token | ETH | ETH |

Arbitrum Orbit (Nitro), settling to Ethereum. Mainnet runs roughly 101ms blocks
at about 0.055 gwei, which is around 850,000 blocks per day. Every tool takes an
optional `network` parameter that defaults to `mainnet`.

---

## Tools

### `get_chain_info`

Chain ID, latest block, gas price, and node client version. Use it to confirm
which network you are on before interpreting anything else.

> "What's the current state of Robinhood Chain?"

```json
{
  "network": "mainnet",
  "chainId": 4663,
  "chainIdMatchesExpected": true,
  "latestBlock": "15009124",
  "gasPrice": { "wei": "56460000", "gwei": "0.05646" },
  "clientVersion": "nitro/v3.11.3-rc.4-4bed0c5/linux-amd64/go1.25.12"
}
```

### `get_balance`

Native ETH balance for an address. ETH is the gas token on this chain.

> "What's the ETH balance of 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73?"

```json
{
  "address": "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  "symbol": "ETH",
  "decimals": 18,
  "raw": "20950208165769640109212",
  "formatted": "20950.208165769640109212",
  "atBlock": "15009511"
}
```

### `get_token_balance`

ERC-20 balance for a holder, formatted with the decimals read from the token
contract **on that same call**.

Decimals are never assumed. USDG uses 6 and WETH uses 18, so a hardcoded 18
would misreport a USDG balance by a factor of a trillion and still render as a
plausible number.

> "How much USDG does 0x95f9… hold?"

```json
{
  "token": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  "symbol": "USDG",
  "decimals": 6,
  "raw": "0",
  "formatted": "0",
  "decimalsSource": "read from the token contract on this call, not assumed"
}
```

### `get_token_info`

Name, symbol, decimals, and total supply for a token address.

> "Tell me about the token at 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"

```json
{
  "name": "Global Dollar",
  "symbol": "USDG",
  "decimals": 6,
  "totalSupply": { "raw": "298192190258213", "formatted": "298192190.258213" },
  "canonical": { "verified": true },
  "warning": "name and symbol are self-reported by the contract and can be set to anything..."
}
```

A contract that implements some of ERC-20 but not all of it reports which
methods were unreadable rather than failing outright. A contract that implements
none of it returns a clear "this is not an ERC-20" error.

### `verify_token_address`

**The anti-scam tool.** Given a ticker and an address, it confirms on-chain
whether that address really is a token reporting that symbol, checks it against
the canonical address for that ticker, and lists every *other* token on
Robinhood Chain trading under the same ticker.

Run it before acting on any token address a user pasted, a site listed, or a
search returned.

#### Why this exists

There is a live, deliberate ticker collision on Robinhood Chain:

| Address | Name | Decimals |
|---|---|---|
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Global Dollar (the real stablecoin) | 6 |
| `0x8218d73C00567A01481495Ad6c5143e00D5BB5b4` | Useless Stupid Degen Gamblers | 18 |

Both report `symbol() == "USDG"`. Both have live pools. Both come back from a
symbol search. Deploying a contract that reports any symbol you like costs one
transaction, so **a matching symbol is necessary but never sufficient**. Only
the address is identity.

> "Is 0x8218d73C00567A01481495Ad6c5143e00D5BB5b4 the real USDG?"

```json
{
  "verdict": "impostor",
  "safeToUseAsClaimedTicker": false,
  "onchain": { "symbol": "USDG", "name": "Useless Stupid Degen Gamblers", "decimals": 18 },
  "symbolMatches": true,
  "canonicalForSymbol": {
    "address": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "name": "Global Dollar",
    "decimals": 6
  },
  "warnings": [
    "DANGER: USDG on Robinhood Chain mainnet is canonically Global Dollar at 0x5fc5…d168. The address you supplied, 0x8218…b5b4, reports the same symbol but is a DIFFERENT contract.",
    "4 distinct tokens on Robinhood Chain currently trade under the ticker USDG."
  ]
}
```

Note `symbolMatches: true` alongside `verdict: "impostor"`. That is the entire
point of the tool.

The four verdicts:

| Verdict | Meaning |
|---|---|
| `canonical` | The address is the hand-verified canonical token for that ticker. The only verdict that sets `safeToUseAsClaimedTicker: true`. |
| `impostor` | The symbol matches, but the canonical token for that ticker lives at a **different** address. Treat as hostile. |
| `symbol_mismatch` | The contract does not report the claimed symbol at all. |
| `symbol_matches_unknown_token` | The symbol matches and no canonical address is on file, so the match is unconfirmed. Verify on the explorer. |

The collision list comes from DexScreener and is best effort: if that API is
unreachable the on-chain verdict is still returned, flagged with
`tickerCollisionScan.status: "unavailable"`.

The canonical list is deliberately tiny: WETH and USDG, both verified by hand.
**Stock Token addresses are intentionally absent.** They live in a dynamic
registry, they are tokenized debt securities issued by Robinhood Assets (Jersey)
Limited that grant no rights in the underlying equity, and Robinhood warns
explicitly that a token matching a ticker at a different address is not
canonical. Hardcoding them would be the exact mistake this tool exists to catch.

### `get_transaction`

A transaction by hash, with its receipt: status, gas used, effective gas price,
block, and logs. A pending transaction returns `status: "pending"` with a null
receipt rather than an error.

> "Did transaction 0x4441… succeed?"

```json
{
  "hash": "0x444161d6b23cfd2fc46d4698e24d25e7c50afc1e72969e8356b16892ac7f78cb",
  "status": "success",
  "from": "0x00000000000000000000000000000000000a4b05",
  "blockNumber": "15009511",
  "receipt": { "status": "success", "gasUsed": "0", "effectiveGasPrice": "55902000", "logCount": 0 }
}
```

### `search_pairs`

DEX pools on Robinhood Chain with current price, liquidity, 24h volume, and 24h
price change, via the DexScreener public API. Search by free text, or pass
`pair_address` for one specific pool.

> "What DEX pairs are trading on Robinhood Chain for USDG?"

```json
{
  "source": "DexScreener",
  "chainSlug": "robinhood",
  "count": 1,
  "distinctBaseTokens": 4,
  "pairs": [
    {
      "dexId": "uniswap",
      "pairAddress": "0x95f9B0AF9282A22F7ef57058e65098db3f667f95",
      "baseToken": { "symbol": "USDG", "name": "Useless Stupid Degen Gamblers" },
      "quoteToken": { "symbol": "WETH" },
      "priceUsd": 0.00003008,
      "liquidityUsd": 15763.21,
      "isDeepestPool": true
    }
  ],
  "warnings": ["4 distinct base tokens matched this query. Symbols are not unique on Robinhood Chain."]
}
```

Results are **candidates for a human to choose from**, never identifiers. One
token often has several pools at different fee tiers with different prices, so
the tool marks the deepest pool by liquidity instead of leaving you to take
index 0. Snapshot only: this source exposes no historical or candle data.

**On DexScreener's terms:** this server runs on your own machine and calls
DexScreener directly on your own behalf, exactly as if you had opened
dexscreener.com yourself. Their terms prohibit proxying or redistributing their
API to third parties, so do not deploy this as a shared remote endpoint that
answers DexScreener queries for other people. Local use is fine; standing up a
public relay is not.

### `read_contract`

Call any `view` or `pure` function on any contract with an ABI fragment you
supply. Use it when no dedicated tool covers what you need.

The ABI may be a human-readable signature or a JSON ABI array.

> "Read slot0 from the Uniswap v3 pool at 0x95f9…"

```json
{
  "address": "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  "functionName": "decimals",
  "stateMutability": "view",
  "result": 6
}
```

Anything not `view` or `pure` is rejected before a request is sent:

```
"transfer" is declared nonpayable, which would require sending a transaction.
This server is read-only and refuses it.
```

---

## Error handling

Every tool result is either data or an `isError` result with a sentence an agent
can act on. Nothing throws out of a handler, so one bad call never takes the
server down and the host does not lose the session. Handled at the boundary:

| Failure | Response |
|---|---|
| Malformed address | Names the parameter, shows the expected shape |
| Address with no bytecode | "It is an externally owned account or an undeployed address, not a token contract" |
| Contract that is not an ERC-20 | "does not implement ERC-20 decimals(), it is not a usable ERC-20 token" |
| Token with balance but no `decimals()` | Returns the raw value and refuses to guess an exponent |
| Transaction not found | Suggests the network mismatch and the ~101ms indexing lag |
| RPC rate limit | Names the limit and points at the RPC override variable |
| RPC unreachable or timing out | Distinguishes egress failure from chain failure |
| DexScreener 429 or outage | Retries with backoff; on-chain verdicts still returned |
| Non-view function in `read_contract` | Refused, with the read-only boundary stated |

## Development

```sh
git clone https://github.com/nirholas/robinhood-toolkit
cd robinhood-toolkit/packages/robinhood-chain-mcp
npm install

npm test          # offline: unit tests plus a real stdio round trip
npm run test:live # adds live mainnet and DexScreener tests
```

`npm test` never touches the network, so it is deterministic in CI. Live tests
are gated behind `ROBINHOOD_MCP_LIVE=1` and read public state only.

Exercise the wire protocol by hand:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"manual","version":"1.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_chain_info","arguments":{}}}' \
  | npx robinhood-chain-mcp
```

## Safety notes

- **Token names and symbols are attacker-controlled strings.** They are returned
  as display data. Never route logic on them, never interpolate them into a
  prompt or a shell command, and escape them in any HTML you render.
- **The chain is centralized today.** Robinhood operates both the sequencer and
  the proposer. [L2BEAT](https://l2beat.com/scaling/projects/robinhood) rates the
  risk profile accordingly. That is normal for a young L2 and it is also a real
  trust assumption.
- **On-chain balances are not brokerage balances.** Self-custody wallet services
  run through Robinhood Non-Custodial, Ltd., a separate legal entity from
  Robinhood Financial LLC and Robinhood Crypto, LLC.
- **Nobody is supervising your agent.** Robinhood states it does not control,
  supervise, monitor, recommend, or audit connected agents.

## Related

Part of [robinhood-toolkit](https://github.com/nirholas/robinhood-toolkit): tools,
runnable examples, and 64 build prompts for Robinhood Chain and Robinhood Crypto.

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. or any
of its subsidiaries. "Robinhood" is used nominatively to identify the platform
this server reads from.

Nothing here is financial advice. This software reads public blockchain data and
makes no representation about the accuracy, safety, or legitimacy of any token,
pool, or contract it reports on.

## License

All Rights Reserved © 2026 [nirholas](https://github.com/nirholas)
