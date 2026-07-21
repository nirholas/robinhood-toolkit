/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · rolling bar window
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */

/**
 * Keep at most `max` bars in the series. Trimming requires setData (update()
 * cannot remove bars), so amortise: only trim once the overflow is worth the
 * full recompute.
 *
 * @param {{setData:(b:any[])=>void, update:(b:any)=>void}} view
 * @param {{max?:number, slack?:number}} [opts]
 */
export function createRollingWindow(view, { max = 5000, slack = 500 } = {}) {
  let bars = [];

  return {
    set(next) {
      bars = next.length > max ? next.slice(next.length - max) : next.slice();
      view.setData(bars);
    },
    push(bar) {
      const last = bars[bars.length - 1];
      if (last && bar.time === last.time) bars[bars.length - 1] = bar;
      else if (!last || bar.time > last.time) bars.push(bar);
      else return;                       // stale, update() would throw

      view.update(bar);

      if (bars.length > max + slack) {
        bars = bars.slice(bars.length - max);
        view.setData(bars);              // one recompute per `slack` bars
      }
    },
    get length() { return bars.length; },
    get bars() { return bars; },
  };
}
/* built by nirholas x.com/nichxbt */
