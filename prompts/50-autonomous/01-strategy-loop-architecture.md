<!--
  robinhood-toolkit · build prompt: the autonomous strategy loop skeleton
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 01 · Strategy loop architecture

## Goal

Build the process skeleton every later prompt in this track plugs into: a
deterministic tick loop that reads market state, produces a signal, asks a
policy engine for permission, routes the order to a broker, and journals the
decision. The loop starts in paper mode and cannot reach a live broker without
an explicit flag flip plus a live-mode preflight.

## Prerequisites

- Node 20+ (`node --version`). The samples use ESM and the built-in test runner.
- `npm i viem` for later prompts in this track. This prompt needs no dependency.
- Read `prompts/00-foundations/01-what-is-robinhood-chain.md` for chain
  constants and `ATTRIBUTION.md` for the header every file must carry.

## Reference facts (verified)

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Sequencer feed | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

- Crypto REST API docs: <https://docs.robinhood.com/crypto/trading>
- Observed mainnet block cadence is roughly 101 ms. A loop that ticks per block
  will tick about 850,000 times a day. Tick on a timer you choose, not on every
  block, unless you have measured that your strategy needs that resolution.
- **Crypto trades 24/7.** There is no closing bell. An equities bot with a bug
  stops trading at 16:00 ET; a crypto bot with a bug trades until it is out of
  money. Every stopping condition on this venue has to be one you wrote:
  cooldowns, daily loss stops, and a kill switch. Treat them as load-bearing
  structure, not as polish.
- Robinhood does not supervise, audit, or rate-limit your agent's strategy. If
  the loop misbehaves, nothing upstream catches it for you.

## Steps

1. Create `packages/agent/` with `package.json` (`"type": "module"`).
2. Define the config surface in `src/config.mjs`. Mode is `paper` by default and
   the only way to get `live` is `AGENT_MODE=live` in the environment. Never
   default to live and never infer live from the presence of API credentials.
3. Define the four seams in `src/ports.mjs` as documented shapes. Every
   component in this track implements one of them:
   - `MarketData.getQuote(symbol) -> { symbol, bid, ask, ts }`
   - `Strategy.decide(ctx) -> Signal | null`
   - `Policy.evaluate(intent, ctx) -> { allow, violations }`
   - `Broker.placeOrder(intent) -> Fill | OrderAck`
   Keeping these as plain objects means the paper broker (prompt 04), the live
   broker (prompt 05), and the backtester (prompt 03) are drop-in swaps.
4. Write the loop in `src/loop.mjs` as a state machine with explicit states:
   `idle -> sampling -> deciding -> gating -> executing -> cooling`. One tick
   advances at most one order. Never allow a tick to overlap itself; guard with
   an in-flight boolean so a slow RPC call cannot double-fire.
5. Make the kill switch checked at the top of every tick, before any market
   read. Two independent triggers: a file on disk (`KILL_SWITCH_FILE`, default
   `./KILL`) and an env var. File first, because during an incident you may be
   able to touch a file but not redeploy the process.
6. Enforce the cooldown in the loop, not in the strategy. Strategies are
   opinionated and will happily fire every tick; the loop is where "no more than
   one fill per N seconds per symbol" lives.
7. Wire the journal call so every tick writes an entry even when it does
   nothing. A journal with gaps cannot be used for a post-mortem. Prompt
   `80-safety/04-audit-logging.md` defines the record format; here just emit the
   object and let the sink be injected.
8. Add a graceful shutdown path on `SIGINT` and `SIGTERM` that stops the timer,
   waits for the in-flight tick, and flushes the journal.

```js
/**
 * robinhood-toolkit · autonomous strategy loop
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { existsSync } from 'node:fs';

export const MODES = Object.freeze({ PAPER: 'paper', LIVE: 'live' });

export function loadConfig(env = process.env) {
  const mode = env.AGENT_MODE === MODES.LIVE ? MODES.LIVE : MODES.PAPER;
  return {
    mode,
    symbols: (env.AGENT_SYMBOLS ?? 'BTC-USD').split(',').map((s) => s.trim()),
    tickMs: Number(env.AGENT_TICK_MS ?? 5000),
    cooldownMs: Number(env.AGENT_COOLDOWN_MS ?? 60000),
    killSwitchFile: env.KILL_SWITCH_FILE ?? './KILL',
    maxTicks: env.AGENT_MAX_TICKS ? Number(env.AGENT_MAX_TICKS) : Infinity,
  };
}

export function killSwitchEngaged(config, env = process.env) {
  if (env.AGENT_KILL === '1') return 'env:AGENT_KILL';
  if (existsSync(config.killSwitchFile)) return `file:${config.killSwitchFile}`;
  return null;
}

export function createLoop({ config, marketData, strategy, policy, broker, journal, clock = Date }) {
  const lastFillAt = new Map();
  let inFlight = false;
  let ticks = 0;
  let timer = null;

  async function tick() {
    if (inFlight) return { state: 'skipped', reason: 'tick_overlap' };
    inFlight = true;
    const startedAt = clock.now();
    const record = { ts: new Date(startedAt).toISOString(), mode: config.mode, tick: ++ticks };

    try {
      const kill = killSwitchEngaged(config);
      if (kill) {
        record.state = 'halted';
        record.reason = kill;
        return record;
      }

      for (const symbol of config.symbols) {
        const since = startedAt - (lastFillAt.get(symbol) ?? -Infinity);
        if (since < config.cooldownMs) {
          record.state = 'cooling';
          record.detail = { symbol, remainingMs: config.cooldownMs - since };
          continue;
        }

        const quote = await marketData.getQuote(symbol);
        const signal = await strategy.decide({ symbol, quote, mode: config.mode });
        if (!signal) {
          record.state = 'idle';
          continue;
        }

        const intent = {
          clientOrderId: `${symbol}-${startedAt}-${ticks}`,
          symbol,
          side: signal.side,
          type: signal.type ?? 'limit',
          quantity: signal.quantity,
          limitPrice: signal.limitPrice,
          notional: signal.quantity * (signal.limitPrice ?? quote.ask),
        };

        const verdict = await policy.evaluate(intent, { quote, mode: config.mode });
        record.intent = intent;
        record.verdict = verdict;

        if (!verdict.allow) {
          record.state = 'blocked';
          continue;
        }

        record.result = await broker.placeOrder(intent);
        record.state = 'executed';
        lastFillAt.set(symbol, clock.now());
      }

      record.state ??= 'idle';
      return record;
    } catch (err) {
      record.state = 'error';
      record.error = String(err?.message ?? err);
      return record;
    } finally {
      inFlight = false;
      record.durationMs = clock.now() - startedAt;
      await journal.write(record);
    }
  }

  return {
    tick,
    async start() {
      if (config.mode === MODES.LIVE) await preflightLive({ config, broker });
      timer = setInterval(() => {
        if (ticks >= config.maxTicks) return void this.stop();
        tick();
      }, config.tickMs);
      return this;
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      while (inFlight) await new Promise((r) => setTimeout(r, 25));
      await journal.flush?.();
    },
  };
}

async function preflightLive({ config, broker }) {
  if (process.env.AGENT_LIVE_CONFIRM !== 'i-understand-this-spends-real-money') {
    throw new Error('live mode requires AGENT_LIVE_CONFIRM to be set explicitly');
  }
  if (killSwitchEngaged(config)) throw new Error('kill switch engaged, refusing live start');
  if (typeof broker.getBalances !== 'function') throw new Error('live broker must expose getBalances');
  const balances = await broker.getBalances();
  if (!balances || Object.keys(balances).length === 0) throw new Error('live preflight: no balances returned');
}
```

Wire it up in `src/main.mjs`:

```js
/**
 * robinhood-toolkit · agent entrypoint
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { loadConfig, createLoop, MODES } from './loop.mjs';

const config = loadConfig();
console.log(`[agent] starting in ${config.mode.toUpperCase()} mode`);
if (config.mode === MODES.PAPER) console.log('[agent] no real orders will be sent');

const loop = await createLoop({
  config,
  marketData: await import('./market/quotes.mjs').then((m) => m.default(config)),
  strategy: await import('./strategy/index.mjs').then((m) => m.default(config)),
  policy: await import('./policy/index.mjs').then((m) => m.default(config)),
  broker: await import(config.mode === MODES.LIVE ? './broker/live.mjs' : './broker/paper.mjs')
    .then((m) => m.default(config)),
  journal: await import('./journal.mjs').then((m) => m.default(config)),
}).start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[agent] ${sig} received, draining`);
    await loop.stop();
    process.exit(0);
  });
}
```

## Deliverable

- `packages/agent/src/loop.mjs` with `loadConfig`, `killSwitchEngaged`,
  `createLoop`, and the live preflight.
- `packages/agent/src/ports.mjs` documenting the four seams.
- `packages/agent/src/main.mjs` entrypoint that selects broker by mode.
- `packages/agent/test/loop.test.js` using `node:test` with stub ports.

## How to verify

```sh
cd packages/agent
node --test                       # unit tests pass with stub ports
AGENT_MAX_TICKS=3 node src/main.mjs   # runs 3 ticks, prints PAPER, exits
touch KILL && node src/main.mjs   # every tick records state "halted"
AGENT_MODE=live node src/main.mjs # throws on missing AGENT_LIVE_CONFIRM
```

The third check is the important one. If the process places an order while
`./KILL` exists, the loop is wrong and nothing downstream in this track is safe
to run.

## Gotchas

- `setInterval` does not wait for an async callback. Without the `inFlight`
  guard, a tick slower than `tickMs` stacks up and you get concurrent orders
  from a loop you believed was serial. This is the single most common way an
  autonomous trader doubles its own position size.
- Cooldown state lives in process memory here. A crash-restart resets it and the
  bot can fire again immediately. Persist `lastFillAt` alongside the journal
  before you run this unattended, and see prompt 07 for the restart lease.
- `config.mode` is read once at startup. Do not add a runtime toggle that flips
  paper to live; a mode change should require a restart so it appears in
  process logs and deploy history.
- Do not put the kill switch check inside the symbol loop only. It belongs at
  the top of the tick so a halt takes effect even if the market data call hangs.
- `Infinity` as `maxTicks` is deliberate. Do not replace it with a large integer
  and assume the loop will stop on its own.
