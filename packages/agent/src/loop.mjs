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
