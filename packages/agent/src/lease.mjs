/**
 * robinhood-toolkit · single-instance lease
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * There is no market close on this venue: a double-started agent runs until the
 * account is empty. The lease is therefore a safety control, not an operational
 * nicety. It fails closed — if the store cannot be reached, the holder does not
 * trade, because "I cannot check whether someone else holds this" and "I hold
 * this" must never be the same code path.
 */
import { randomUUID } from 'node:crypto';

/**
 * The store contract the lease and crash-loop guard depend on. Any backend that
 * can do a compare-and-set satisfies it: a Redis SET NX PX, a Postgres row with
 * an optimistic version column, or an object-store conditional write.
 *
 * @typedef  {object} LeaseStore
 * @property {(key: string) => Promise<any>} get
 *   Return the current value, or null if unset. MUST reject (not resolve null)
 *   when the backend is unreachable, so callers can fail closed.
 * @property {(key: string, expected: any, next: any) => Promise<boolean>} compareAndSet
 *   Atomically set `key` to `next` only if its current value equals `expected`.
 *   Resolves true on success, false if another writer won the race.
 */

/**
 * @param {object}      opts
 * @param {LeaseStore}  opts.store
 * @param {string}      [opts.key='agent:trading:lease']
 * @param {number}      [opts.ttlMs=30000]   Must exceed your worst-case tick.
 * @param {(err: Error) => any} [opts.onLost] Called when the lease is lost mid-run.
 */
export function createLease({ store, key = 'agent:trading:lease', ttlMs = 30_000, onLost }) {
  const holder = `${process.env.HOSTNAME ?? 'local'}:${process.pid}:${randomUUID().slice(0, 8)}`;
  let renewTimer = null;
  let held = false;

  async function tryAcquire() {
    const now = Date.now();
    const current = await store.get(key); // throws if store is unreachable: fail closed
    if (current && current.holder !== holder && current.expiresAt > now) return false;
    return store.compareAndSet(key, current, { holder, expiresAt: now + ttlMs });
  }

  return {
    holder,
    get held() {
      return held;
    },

    async acquire() {
      held = await tryAcquire();
      if (!held) return false;
      renewTimer = setInterval(async () => {
        try {
          const ok = await tryAcquire();
          if (!ok) throw new Error('lease taken by another instance');
        } catch (err) {
          held = false;
          clearInterval(renewTimer);
          console.error(`[lease] lost: ${err.message}. Halting trading.`);
          await onLost?.(err);
        }
      }, Math.floor(ttlMs / 3));
      renewTimer.unref?.();
      return true;
    },

    async release() {
      if (renewTimer) clearInterval(renewTimer);
      held = false;
      const current = await store.get(key).catch(() => null);
      if (current?.holder === holder) await store.compareAndSet(key, current, null).catch(() => {});
    },
  };
}

/**
 * Refuses to start after repeated fast restarts. A crash loop against a ~101 ms
 * chain plus an eager retry policy can emit a lot of orders before anyone
 * notices; this turns the (N+1)th restart in the window into a hard stop that a
 * human must clear.
 *
 * @param {object}     opts
 * @param {LeaseStore} opts.store
 * @param {string}     [opts.key='agent:restarts']
 * @param {number}     [opts.windowMs=600000]
 * @param {number}     [opts.max=5]
 * @returns {Promise<number>} The number of starts recorded within the window.
 */
export async function crashLoopGuard({ store, key = 'agent:restarts', windowMs = 600_000, max = 5 }) {
  const now = Date.now();
  const record = (await store.get(key)) ?? { stamps: [] };
  const stamps = [...record.stamps, now].filter((t) => now - t < windowMs);
  await store.compareAndSet(key, record, { stamps });
  if (stamps.length > max) {
    throw new Error(`crash loop: ${stamps.length} starts in ${windowMs / 60000}m. Clear ${key} to resume.`);
  }
  return stamps.length;
}
