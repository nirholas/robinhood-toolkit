/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · frame-coalesced chart updates
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/**
 * Collapse many update() calls into one per animation frame. Only the newest
 * bar per timestamp survives, which is exactly right for a forming candle.
 *
 * @param {(bar: object) => void} apply
 */
export function coalesceUpdates(apply) {
  /** @type {Map<number, object>} */
  const pending = new Map();
  let frame = null;
  let dropped = 0;

  function flush() {
    frame = null;
    if (pending.size === 0) return;
    // Ascending: update() throws on a timestamp before the last applied one.
    const bars = [...pending.values()].sort((a, b) => a.time - b.time);
    pending.clear();
    for (const bar of bars) apply(bar);
  }

  return {
    push(bar) {
      if (pending.has(bar.time)) dropped += 1;
      pending.set(bar.time, bar);
      // A hidden tab never fires rAF. Without this the map grows unbounded
      // for as long as the tab stays backgrounded.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        if (pending.size > 64) flush();
        return;
      }
      if (frame === null) frame = requestAnimationFrame(flush);
    },
    flush,
    get stats() { return { pending: pending.size, dropped }; },
    destroy() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      pending.clear();
    },
  };
}
/* built by nirholas x.com/nichxbt */
