/* Match-detail bottom sheet: opens from any match card, re-renders on refresh. */
import { state } from './state.js';
import { esc, flagFor, statusClass, isFinished } from './meta.js';

const $ = (id) => document.getElementById(id);
let openMatchId = null;
let lastTrigger = null;

function sheetHtml(m) {
  const setRows = m.sets.map(([a, b], i) => `
    <tr>
      <td class="dim">Set ${i + 1}</td>
      <td class="${a > b ? 'won' : ''}">${esc(a)}</td>
      <td class="${b > a ? 'won' : ''}">${esc(b)}</td>
    </tr>`).join('');

  const cards = (state.cautions || [])
    .flatMap((p) => p.events
      .filter((e) => e.matchId === m.id)
      .map((e) => ({ name: ((p.first ? p.first + ' ' : '') + p.name).trim(), team: p.teamName, type: e.type })));
  const cardRows = cards.map((c) =>
    `<div class="sheet-card-row"><span class="badge ${esc(c.type.toLowerCase())}">${esc(c.type)}</span> ${esc(c.name)} <span class="dim">· ${esc(c.team)}</span></div>`).join('');

  const refs = state.referees?.get?.(m.id) || [];
  const refLine = refs.length
    ? `<p class="sheet-meta">Referees: ${refs.map((r) => `${esc(r.role)}: ${esc(r.referee?.name ?? '?')}`).join(', ')}</p>`
    : '';

  return `
    <p class="sheet-meta">${esc(m.category)} · ${esc(m.round)} · #${esc(m.nr)}
      <span class="status ${statusClass(m.status)}">${esc(m.status)}</span></p>
    <div class="sheet-teams">
      <div class="sheet-team"><span class="flag">${flagFor(m.teamA)}</span> ${esc(m.teamA)}
        <span class="sheet-sets ${isFinished(m) && m.setsA > m.setsB ? 'win' : ''}">${esc(m.setsA)}</span></div>
      <div class="sheet-team"><span class="flag">${flagFor(m.teamB)}</span> ${esc(m.teamB)}
        <span class="sheet-sets ${isFinished(m) && m.setsB > m.setsA ? 'win' : ''}">${esc(m.setsB)}</span></div>
    </div>
    ${m.sets.length ? `<table class="sheet-set-table"><tbody>${setRows}</tbody></table>` : ''}
    <p class="sheet-meta">${esc(m.day || '')} ${esc(m.time || '')}${m.court ? ` · Court ${esc(m.court)}` : ''}</p>
    ${refLine}
    ${cardRows ? `<p class="section-title sub">Cards</p>${cardRows}` : ''}
  `;
}

function open(matchId, trigger) {
  const m = state.matches.find((x) => x.id === matchId);
  if (!m) return;
  openMatchId = matchId;
  lastTrigger = trigger || null;
  $('sheetBody').innerHTML = sheetHtml(m);
  $('matchSheet').hidden = false;
  document.body.style.overflow = 'hidden';
  $('sheetClose').focus();
}

export function closeMatchDetail() {
  if (openMatchId === null) return;
  const closedMatchId = openMatchId;
  openMatchId = null;
  $('matchSheet').hidden = true;
  document.body.style.overflow = '';
  if (lastTrigger && document.contains(lastTrigger)) {
    lastTrigger.focus();
  } else {
    // The poll re-render may have replaced the card DOM node while the
    // sheet was open; fall back to the (new) card for the same match.
    document.querySelector(`[data-match-id="${CSS.escape(closedMatchId)}"]`)?.focus?.();
  }
  lastTrigger = null;
}

export function refreshMatchDetail() {
  if (openMatchId === null) return;
  const m = state.matches.find((x) => x.id === openMatchId);
  if (!m) { closeMatchDetail(); return; }
  $('sheetBody').innerHTML = sheetHtml(m);
}

export function initMatchDetail() {
  document.querySelector('main.content').addEventListener('click', (e) => {
    const card = e.target.closest('[data-match-id]');
    if (card) open(card.dataset.matchId, card);
  });
  document.querySelector('main.content').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-match-id]');
    if (card) { e.preventDefault(); open(card.dataset.matchId, card); }
  });
  $('sheetClose').onclick = closeMatchDetail;
  $('matchSheet').onclick = (e) => { if (e.target === $('matchSheet')) closeMatchDetail(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMatchDetail(); });

  // Minimal focus trap: keep Tab/Shift+Tab cycling inside the open sheet.
  $('matchSheet').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...$('matchSheet').querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
