<!--
  robinhood-toolkit · agent package readme
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# @robinhood-toolkit/agent

The autonomous trading loop: a tick scheduler, a kill switch, four swappable
seams, and a shared cost model that the paper broker and the backtester both
import so their fills cannot drift apart.

This is the finished skeleton for the
[`prompts/50-autonomous`](../../prompts/50-autonomous/) track. It runs today in
paper mode. Three of the seams ship as clearly-labelled placeholders, and each
placeholder fails in the safe direction rather than pretending to work.

## Run it

```sh
cd packages/agent
npm start
```

Paper mode is the default, and switching to live is a deliberate act: `npm start`
sends no order anywhere until `AGENT_MODE=live` is set **and** a real broker and
policy are wired in.

Watch one tick and exit:

```sh
AGENT_MAX_TICKS=1 AGENT_TICK_MS=200 npm start
```

```
[agent] starting in PAPER mode
[agent] no real orders will be sent
[journal] tick=1 mode=paper state=idle
```

## Configuration

Everything is read from the environment by `loadConfig()` in
[`src/loop.mjs`](src/loop.mjs). There is no config file to lose track of.

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_MODE` | `paper` | `live` is the only value that enables real order placement. Anything else, including a typo, resolves to paper. |
| `AGENT_SYMBOLS` | `BTC-USD` | Comma-separated pairs evaluated each tick. |
| `AGENT_TICK_MS` | `5000` | Interval between ticks. Overlapping ticks are skipped, not queued. |
| `AGENT_COOLDOWN_MS` | `60000` | Per-symbol quiet period after a fill. |
| `AGENT_MAX_TICKS` | unlimited | Stop after N ticks. Useful for smoke runs. |
| `KILL_SWITCH_FILE` | `./KILL` | Creating this file halts trading on the next tick. |
| `AGENT_KILL` | unset | Set to `1` to halt without touching the filesystem. |

## The kill switch

Checked at the top of every tick, before any market data is read:

```sh
touch KILL      # halts on the next tick
rm KILL         # resumes
```

`killSwitchEngaged()` is exported from `src/loop.mjs`, so a monitor or an alert
handler can consult the same predicate the loop uses instead of reimplementing
it.

## The four seams

[`src/ports.mjs`](src/ports.mjs) is the contract. It exports nothing at runtime
on purpose: the JSDoc typedefs there are the single source of truth for each
seam, and every module below implements exactly one of them. Because the loop
only ever talks to these four objects, the backtester, the paper broker, and the
live broker are drop-in swaps for each other.

| Seam | Shipped implementation | Status |
|---|---|---|
| MarketData | [`src/market/quotes.mjs`](src/market/quotes.mjs) | Placeholder. Returns a static, obviously-fake quote so the loop is runnable end to end. Replace it with a real feed. |
| Strategy | [`src/strategy/momentum.mjs`](src/strategy/momentum.mjs) | Real. EMA crossover that emits a signal only on a flat/long transition, never on every tick the condition holds. |
| Policy | [`src/policy/index.mjs`](src/policy/index.mjs) | Placeholder that **blocks everything**. A skeleton with no risk rules must fail closed, never open. |
| Broker | [`src/broker/paper.mjs`](src/broker/paper.mjs), [`src/broker/live.mjs`](src/broker/live.mjs) | Paper is real and prices fills through the shared cost model. Live is selected only by `AGENT_MODE=live`. |
| Journal | [`src/journal.mjs`](src/journal.mjs) | Placeholder. Logs one compact line per tick to stdout. Every tick writes a record, including no-op ticks, so a post-mortem has no gaps. |

## Tick states

Each tick produces exactly one journal record whose `state` is one of:

| State | Meaning |
|---|---|
| `halted` | The kill switch is engaged. Nothing else ran. |
| `cooling` | The symbol is inside its post-fill cooldown. |
| `idle` | The strategy returned no signal. |
| `blocked` | The policy rejected the intent. |
| `executed` | The broker accepted the order. |
| `error` | The tick threw. The message is recorded and the loop keeps running. |
| `skipped` | The previous tick was still in flight. Ticks never overlap. |

## Supporting modules

| Module | What it does |
|---|---|
| [`src/backtest/costs.mjs`](src/backtest/costs.mjs) | The one cost model: taker fee, half spread, and size-dependent slippage. Imported by both the paper broker and the backtester. If paper fills and backtest fills ever disagree, someone reimplemented this instead of importing it. |
| [`src/positions.mjs`](src/positions.mjs) | Position book with VWAP entry, realized PnL, fees, and reconciliation against broker state. |
| [`src/market/indicators.mjs`](src/market/indicators.mjs) | EMA and the other indicator primitives the strategies use. |
| [`src/market/bars.mjs`](src/market/bars.mjs) | Bar aggregation and normalization. |
| [`src/lease.mjs`](src/lease.mjs) | Single-writer lease, so two copies of the agent cannot trade the same account at once. |
| [`src/monitor/metrics.mjs`](src/monitor/metrics.mjs) | Dependency-free counters, gauges, histograms, and a health server. Fewer moving parts means fewer ways to crash the trading process. |
| [`src/monitor/alerts.mjs`](src/monitor/alerts.mjs) | Alert evaluation against [`monitor/alerts.yaml`](monitor/alerts.yaml). |

## Before you switch to live

`AGENT_MODE=live` runs a preflight against the broker, but preflight is not a
substitute for the [`prompts/80-safety`](../../prompts/80-safety/) track. Nobody
supervises your agent. Read that track first, wire a real policy engine into the
Policy seam, and keep the kill switch somewhere you can reach from your phone.
