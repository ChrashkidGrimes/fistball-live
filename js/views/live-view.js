/* Cross-category Live tab: matches in progress and up-next, across all
   categories, grouped either by time or by court. */
import { state, persist, restore } from '../state.js';
import { esc } from '../meta.js';
import { selectLive, selectUpNext, groupByCourt } from '../live-select.js';
import { matchCard } from './matches-view.js';

const $ = (id) => document.getElementById(id);
const UP_NEXT_COUNT = 6;

function mode() {
  return restore('fb_live_mode') === 'court' ? 'court' : 'time';
}

function section(title, cards, extraClass = '') {
  if (!cards.length) return '';
  return `<p class="section-title ${extraClass}">${esc(title)}</p>${cards.join('')}`;
}

export function renderLive() {
  const host = $('live');
  const card = (m) => matchCard(m, { showCategory: true });
  const toggle = `
    <div class="cross-bar">
      <p class="section-title">Across all categories</p>
      <div class="cross-toggle">
        <button class="chip ${mode() === 'time' ? 'is-active' : ''}" data-live-mode="time" aria-pressed="${mode() === 'time'}">By time</button>
        <button class="chip ${mode() === 'court' ? 'is-active' : ''}" data-live-mode="court" aria-pressed="${mode() === 'court'}">By court</button>
      </div>
    </div>`;

  let body = '';
  if (mode() === 'time') {
    const live = selectLive(state.matches).map(card);
    const next = selectUpNext(state.matches, UP_NEXT_COUNT).map(card);
    body = section('Live now', live) + section('Up next', next, 'sub');
    if (!live.length && !next.length) {
      body = `<div class="empty">No live or upcoming matches right now — see <b>Matches</b> for full results.</div>`;
    }
  } else {
    const groups = groupByCourt(state.matches);
    if (!groups.length) {
      body = `<div class="empty">No live or upcoming matches right now — see <b>Matches</b> for full results.</div>`;
    }
    for (const g of groups) {
      const title = g.court === null ? 'No court assigned' : `Court ${g.court}`;
      body += section(title, [...g.live.map(card), ...g.upNext.map(card)], 'sub');
    }
  }

  host.innerHTML = toggle + body;
  host.querySelectorAll('[data-live-mode]').forEach((b) => {
    b.onclick = () => { persist('fb_live_mode', b.dataset.liveMode); renderLive(); };
  });
}
