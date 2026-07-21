/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · dashboard entry
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { BOARD } from './board.js';
import { createBoardStore } from './store.js';
import { mountGrid } from './grid.js';

const store = createBoardStore(BOARD, { refreshMs: 20_000 });

const grid = mountGrid(document.querySelector('#board'), store, {
  onSelect: (pairAddress) => {
    window.location.href = `/pair.html?pair=${encodeURIComponent(pairAddress)}`;
  },
});

store.start();

window.addEventListener('beforeunload', () => { grid.destroy(); store.destroy(); });
/* built by nirholas x.com/nichxbt */
