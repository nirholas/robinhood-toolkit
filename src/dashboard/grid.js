/**
 * robinhood-toolkit · dashboard grid with sorting and filtering
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createTile } from './tile.js';

const SORTS = {
  liquidity: (a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0),
  volume:    (a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0),
  gainers:   (a, b) => (b.priceChange24h ?? -Infinity) - (a.priceChange24h ?? -Infinity),
  losers:    (a, b) => (a.priceChange24h ?? Infinity) - (b.priceChange24h ?? Infinity),
  name:      (a, b) => a.label.localeCompare(b.label),
};

export function mountGrid(container, store, { onSelect = () => {} } = {}) {
  const tiles = new Map();
  let sort = 'liquidity';
  let filter = '';

  const controls = document.createElement('div');
  controls.className = 'grid-controls';
  controls.innerHTML = `
    <label class="sr-only" for="pair-filter">Filter pairs</label>
    <input id="pair-filter" type="search" placeholder="Filter pairs" autocomplete="off" />
    <label class="sr-only" for="pair-sort">Sort by</label>
    <select id="pair-sort">
      ${Object.keys(SORTS).map((k) => `<option value="${k}">${k}</option>`).join('')}
    </select>
    <span class="grid-status" role="status" aria-live="polite"></span>
  `;

  const gridEl = document.createElement('div');
  gridEl.className = 'grid';

  const emptyEl = document.createElement('p');
  emptyEl.className = 'grid-empty';
  emptyEl.hidden = true;

  container.append(controls, gridEl, emptyEl);

  const statusEl = controls.querySelector('.grid-status');
  const filterEl = controls.querySelector('#pair-filter');
  const sortEl = controls.querySelector('#pair-sort');

  let debounce = null;
  filterEl.addEventListener('input', (e) => {
    clearTimeout(debounce);
    const value = e.target.value;
    debounce = setTimeout(() => { filter = value.trim().toLowerCase(); render(lastRows); }, 120);
  });
  sortEl.addEventListener('change', (e) => { sort = e.target.value; render(lastRows); });

  gridEl.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (tile) onSelect(tile.dataset.pair);
  });
  gridEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    onSelect(tile.dataset.pair);
  });

  let lastRows = [];

  function render(rows) {
    lastRows = rows;

    const visible = rows
      .filter((r) => !filter || r.label.toLowerCase().includes(filter)
        || r.base.symbol.toLowerCase().includes(filter)
        || r.pairAddress.toLowerCase().includes(filter))
      .sort(SORTS[sort]);

    if (rows.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Loading pairs from DexScreener…';
      return;
    }
    if (visible.length === 0) {
      emptyEl.hidden = false;
      emptyEl.textContent = `No pairs match "${filter}". Clear the filter to see all ${rows.length}.`;
      gridEl.replaceChildren();
      return;
    }
    emptyEl.hidden = true;

    // Reuse tile instances. Recreating a chart per refresh leaks canvases and
    // is the fastest way to make a 30-tile board unusable.
    const ordered = [];
    for (const row of visible) {
      const key = row.pairAddress.toLowerCase();
      let tile = tiles.get(key);
      if (!tile) {
        tile = createTile(row);
        tiles.set(key, tile);
      }
      tile.update(row, store.sparkline(row.pairAddress));
      ordered.push(tile.el);
    }
    // replaceChildren reorders in one reflow rather than N appends.
    gridEl.replaceChildren(...ordered);

    for (const [key, tile] of tiles) {
      if (!visible.some((r) => r.pairAddress.toLowerCase() === key) && !tile.el.isConnected) {
        // keep the instance for reuse; it is cheap and the board is bounded
      }
    }
  }

  const unsubscribe = store.subscribe(({ rows, error }) => {
    statusEl.textContent = error
      ? `Stale: ${error.message}. Retrying…`
      : `${rows.length} pairs · updated ${new Date().toLocaleTimeString()}`;
    statusEl.dataset.state = error ? 'error' : 'ok';
    render(rows);
  });

  return {
    destroy() {
      unsubscribe();
      clearTimeout(debounce);
      for (const tile of tiles.values()) tile.destroy();
      tiles.clear();
      container.replaceChildren();
    },
  };
}
