import { registerScreen } from '../app.js';
import {
  escapeHtml, listTournaments, listCategories, listMatches, getMatch, startMatch, listRefereeAssignments,
  listSets, recordPoint, undoLastPoint, recordTimeout, tagLastPoint,
} from '../db.js';

let currentMatchId = null;

function currentSetNumber(sets) {
  for (let n = 1; n <= 99; n++) {
    const set = sets.find((s) => s.set_number === n);
    if (!set || !set.winner_team_id) return n;
  }
  return 1;
}

async function renderHeader(match) {
  const referees = await listRefereeAssignments(match.id);
  const refereeList = referees.length
    ? referees.map((r) => `${escapeHtml(r.role)}: ${escapeHtml(r.referee_name)}`).join(', ')
    : '—';
  const headerWrap = document.getElementById('gameReportHeader');
  headerWrap.innerHTML = `
    <h3>${escapeHtml(match.team_a.name)} vs. ${escapeHtml(match.team_b.name)}</h3>
    <p>Court: ${escapeHtml(match.court?.name || '—')} · Best of ${match.best_of} · Status: ${escapeHtml(match.status)}</p>
    <p>Schiedsrichter: ${refereeList}</p>
    ${match.status === 'scheduled' ? '<button id="startMatchBtn">Match starten</button>' : ''}
    <p id="gameReportError" class="error" hidden></p>
    <div id="gameReportBody"></div>
  `;
  if (match.status === 'scheduled') {
    document.getElementById('startMatchBtn').onclick = async () => {
      const errorEl = document.getElementById('gameReportError');
      try {
        await startMatch(match.id);
        await selectMatch(match.id);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    };
  }
  if (match.status === 'live') {
    await renderScoringBody(match);
  }
}

async function renderScoringBody(match) {
  const sets = await listSets(match.id);
  const setNumber = currentSetNumber(sets);
  const current = sets.find((s) => s.set_number === setNumber) || { points_a: 0, points_b: 0, timeouts_a: 0, timeouts_b: 0 };

  const body = document.getElementById('gameReportBody');
  body.innerHTML = `
    <h4>Satz ${setNumber}</h4>
    <div class="gr-score">
      <div>
        <span>${escapeHtml(match.team_a.name)}: <span id="gr_score_a">${current.points_a}</span></span>
        <button id="pointA">+1 ${escapeHtml(match.team_a.name)}</button>
        <button id="timeoutA">Timeout</button>
        <span>Timeouts: <span id="gr_timeouts_a">${current.timeouts_a}</span></span>
      </div>
      <div>
        <span>${escapeHtml(match.team_b.name)}: <span id="gr_score_b">${current.points_b}</span></span>
        <button id="pointB">+1 ${escapeHtml(match.team_b.name)}</button>
        <button id="timeoutB">Timeout</button>
        <span>Timeouts: <span id="gr_timeouts_b">${current.timeouts_b}</span></span>
      </div>
    </div>
    <button id="undoBtn">Rückgängig</button>
    <span id="gr_tag_hint">Letzter Punkt: <button id="tagAceBtn">Ass</button><button id="tagFaultBtn">Aufschlagfehler</button></span>
    <div id="gr_sets_summary">
      ${sets.map((s) => `<span>Satz ${s.set_number}: ${s.points_a}:${s.points_b}${s.winner_team_id ? ' ✓' : ''}</span>`).join(' · ')}
    </div>
  `;

  const errorEl = document.getElementById('gameReportError');
  const withErrorHandling = (fn) => async () => {
    try {
      await fn();
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  document.getElementById('pointA').onclick = withErrorHandling(() => recordPoint(match.id, setNumber, 'a'));
  document.getElementById('pointB').onclick = withErrorHandling(() => recordPoint(match.id, setNumber, 'b'));
  document.getElementById('timeoutA').onclick = withErrorHandling(() => recordTimeout(match.id, setNumber, 'a'));
  document.getElementById('timeoutB').onclick = withErrorHandling(() => recordTimeout(match.id, setNumber, 'b'));
  document.getElementById('undoBtn').onclick = withErrorHandling(() => undoLastPoint(match.id, setNumber));
  document.getElementById('tagAceBtn').onclick = withErrorHandling(() => tagLastPoint(match.id, setNumber, 'ace'));
  document.getElementById('tagFaultBtn').onclick = withErrorHandling(() => tagLastPoint(match.id, setNumber, 'service_fault'));
}

async function selectMatch(matchId) {
  currentMatchId = matchId;
  const match = await getMatch(matchId);
  await renderHeader(match);
}

async function render(main) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Game Report</h2>
    <label>Turnier<select id="gr_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="gr_category"></select></label>
    <label>Match<select id="gr_match"></select></label>
    <div id="gameReportHeader"></div>
  `;

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('gr_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshMatches(categoryId) {
    const matches = await listMatches(categoryId);
    const open = matches.filter((m) => m.status === 'scheduled' || m.status === 'live');
    document.getElementById('gr_match').innerHTML = open.map((m) =>
      `<option value="${m.id}">${escapeHtml(m.team_a.name)} vs. ${escapeHtml(m.team_b.name)} (${escapeHtml(m.status)})</option>`
    ).join('');
    return open;
  }

  document.getElementById('gr_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) {
      const matches = await refreshMatches(categories[0].id);
      if (matches[0]) await selectMatch(matches[0].id);
    }
  };
  document.getElementById('gr_category').onchange = async (e) => {
    const matches = await refreshMatches(e.target.value);
    if (matches[0]) await selectMatch(matches[0].id);
  };
  document.getElementById('gr_match').onchange = async (e) => {
    await selectMatch(e.target.value);
  };

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) {
      const matches = await refreshMatches(categories[0].id);
      if (matches[0]) await selectMatch(matches[0].id);
    }
  }
}

registerScreen('game-report', { render });
