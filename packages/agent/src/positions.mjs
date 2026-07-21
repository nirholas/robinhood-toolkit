/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · position book with VWAP entry and reconciliation
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
export function createPositionBook() {
  const book = new Map();

  function get(symbol) {
    if (!book.has(symbol)) {
      book.set(symbol, {
        symbol, quantity: 0, avgEntry: 0, realizedPnl: 0, fees: 0,
        openedAt: null, highWaterMark: null, orderIds: [],
      });
    }
    return book.get(symbol);
  }

  return {
    get,
    all: () => [...book.values()].filter((p) => p.quantity !== 0),

    applyFill({ symbol, side, filledQuantity, filledPrice, fee = 0, clientOrderId, ts }) {
      const p = get(symbol);
      const signed = side === 'buy' ? filledQuantity : -filledQuantity;
      const opening = p.quantity === 0 || Math.sign(p.quantity) === Math.sign(signed);

      if (opening) {
        const newQty = p.quantity + signed;
        // VWAP over absolute size. Average entry only moves when adding.
        p.avgEntry = (p.avgEntry * Math.abs(p.quantity) + filledPrice * filledQuantity) / Math.abs(newQty);
        p.quantity = newQty;
        p.openedAt ??= ts ?? new Date().toISOString();
      } else {
        const closing = Math.min(Math.abs(signed), Math.abs(p.quantity));
        const direction = p.quantity > 0 ? 1 : -1;
        p.realizedPnl += (filledPrice - p.avgEntry) * closing * direction;
        p.quantity += signed;
        // Average entry of the remainder is unchanged. Do not recompute it here.
        if (Math.abs(p.quantity) < 1e-12) {
          p.quantity = 0;
          p.avgEntry = 0;
          p.openedAt = null;
          p.highWaterMark = null;
        } else if (Math.sign(p.quantity) !== direction) {
          p.avgEntry = filledPrice; // flipped through zero, new position
          p.openedAt = ts ?? new Date().toISOString();
        }
      }

      p.fees += fee;
      p.orderIds.push(clientOrderId);
      return p;
    },

    unrealized(symbol, mark) {
      const p = get(symbol);
      return p.quantity === 0 ? 0 : (mark - p.avgEntry) * p.quantity;
    },

    equity(marks, cash) {
      return [...book.values()].reduce((a, p) => a + p.quantity * (marks[p.symbol] ?? p.avgEntry), cash);
    },
  };
}

export function reconcile({ local, remote, dustTolerance = 1e-8, maxDriftPct = 1 }) {
  const symbols = new Set([...Object.keys(remote), ...local.all().map((p) => p.symbol)]);
  const diffs = [];

  for (const symbol of symbols) {
    const localQty = local.get(symbol).quantity;
    const remoteQty = Number(remote[symbol] ?? 0);
    const delta = remoteQty - localQty;
    if (Math.abs(delta) <= dustTolerance) continue;

    const driftPct = remoteQty !== 0 ? Math.abs(delta / remoteQty) * 100 : Infinity;
    diffs.push({ symbol, localQty, remoteQty, delta, driftPct });
  }

  const critical = diffs.some((d) => d.driftPct > maxDriftPct);
  return {
    ok: diffs.length === 0,
    critical,
    diffs,
    action: critical ? 'halt_and_adopt_remote' : diffs.length ? 'adopt_remote' : 'none',
  };
}

/**
 * Overwrite the local book to match the reconciled remote truth. Called after
 * `reconcile` reports a diff: the remote is authoritative, so the local cache is
 * corrected in place. Entry price and history for a symbol we did not know about
 * are unknown — mark the adopted quantity at `marks[symbol]` so unrealized PnL
 * starts at zero rather than inheriting a bogus average.
 */
export function adoptRemote({ local, remote, marks = {}, ts }) {
  const symbols = new Set([...Object.keys(remote), ...local.all().map((p) => p.symbol)]);
  const adopted = [];

  for (const symbol of symbols) {
    const p = local.get(symbol);
    const remoteQty = Number(remote[symbol] ?? 0);
    if (p.quantity === remoteQty) continue;

    if (Math.abs(remoteQty) < 1e-12) {
      // Remote says flat: realized PnL and fees stay, live figures reset.
      p.quantity = 0;
      p.avgEntry = 0;
      p.openedAt = null;
      p.highWaterMark = null;
    } else {
      p.quantity = remoteQty;
      // We cannot know the true entry from a bare quantity snapshot; anchor to
      // the current mark so exits and PnL are computed against something real.
      p.avgEntry = marks[symbol] ?? p.avgEntry ?? 0;
      p.openedAt ??= ts ?? new Date().toISOString();
      p.highWaterMark = null;
    }
    adopted.push({ symbol, quantity: p.quantity, avgEntry: p.avgEntry });
  }

  return adopted;
}
/* built by nirholas x.com/nichxbt */
