/**
 * robinhood-toolkit · dashboard tile with sparkline
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 *
 * Charting by TradingView Lightweight Charts™ (Apache-2.0).
 * TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.
 * https://www.tradingview.com/
 */
import { createChart, AreaSeries } from 'lightweight-charts';
import { formatPrice, formatUsd, formatPct, isV4Pool } from './board.js';

const UP = '#d4d4d4';
const DOWN = '#525252';

export function createTile(row) {
  const el = document.createElement('article');
  el.className = 'tile';
  el.dataset.pair = row.pairAddress;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `${row.label} chart, price ${formatPrice(row.priceUsd)} US dollars`);

  el.innerHTML = `
    <header class="tile-head">
      <span class="tile-label"></span>
      <span class="tile-badge"></span>
    </header>
    <div class="tile-spark" aria-hidden="true"></div>
    <dl class="tile-stats">
      <div><dt>Price</dt><dd class="s-price"></dd></div>
      <div><dt>24h</dt><dd class="s-change"></dd></div>
      <div><dt>Liquidity</dt><dd class="s-liq"></dd></div>
      <div><dt>Volume 24h</dt><dd class="s-vol"></dd></div>
    </dl>
  `;

  const sparkEl = el.querySelector('.tile-spark');
  // Only one attribution logo is needed per page, not per tile. The page footer
  // carries the required TradingView credit; see index.html below.
  const chart = createChart(sparkEl, {
    width: 0,
    height: 56,
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: 'transparent', attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    rightPriceScale: { visible: false },
    leftPriceScale: { visible: false },
    timeScale: { visible: false },
    crosshair: { horzLine: { visible: false }, vertLine: { visible: false } },
    handleScroll: false,
    handleScale: false,
  });

  const series = chart.addSeries(AreaSeries, {
    lineColor: UP,
    lineWidth: 1,
    topColor: 'rgba(212,212,212,0.18)',
    bottomColor: 'rgba(212,212,212,0)',
    priceLineVisible: false,
    lastValueVisible: false,
  });

  let flashTimer = null;

  function update(next, sparkValues) {
    el.querySelector('.tile-label').textContent = next.label;

    const badge = el.querySelector('.tile-badge');
    badge.textContent = isV4Pool(next.pairAddress) ? 'v4' : (next.labels?.[0] ?? 'v3');

    el.querySelector('.s-price').textContent = formatPrice(next.priceUsd);
    el.querySelector('.s-liq').textContent = formatUsd(next.liquidityUsd);
    el.querySelector('.s-vol').textContent = formatUsd(next.volume24h);

    const change = el.querySelector('.s-change');
    change.textContent = formatPct(next.priceChange24h);
    change.dataset.dir = Number(next.priceChange24h) >= 0 ? 'up' : 'down';

    const rising = Number(next.priceChange24h) >= 0;
    series.applyOptions({
      lineColor: rising ? UP : DOWN,
      topColor: rising ? 'rgba(212,212,212,0.18)' : 'rgba(82,82,82,0.18)',
      bottomColor: 'rgba(0,0,0,0)',
    });

    if (sparkValues.length > 1) {
      // Synthetic evenly spaced timestamps: the x-axis is hidden, only shape
      // matters, and real poll timestamps produce uneven spacing that reads as
      // noise at 56px tall.
      const base = Math.floor(Date.now() / 1000) - sparkValues.length * 60;
      series.setData(sparkValues.map((v, i) => ({ time: base + i * 60, value: v })));
      chart.timeScale().fitContent();
    }

    if (next.tick !== 0) {
      el.dataset.flash = next.tick > 0 ? 'up' : 'down';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { delete el.dataset.flash; }, 600);
    }
  }

  update(row, []);

  return {
    el,
    update,
    destroy() {
      clearTimeout(flashTimer);
      chart.remove();
      el.remove();
    },
  };
}
