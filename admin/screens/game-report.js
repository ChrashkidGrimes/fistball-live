import { registerScreen } from '../app.js';
import {
  escapeHtml, listTournaments, listCategories, listMatches, getMatch, startMatch, listRefereeAssignments,
  listSets, recordPoint, undoLastPoint, recordTimeout, tagLastPoint,
  listPlayers, createPlayerEvent, listPlayerEvents,
  createSubstitution, listSubstitutions,
  createMatchIncident, listMatchIncidents,
} from '../db.js';

let currentMatchId = null;

// Bumped on every selectMatch() call. Each render step (after its own
// await) checks its captured generation against the current one and
// aborts without touching the DOM if a newer selectMatch() has since
// started — otherwise two overlapping render chains (e.g. two dropdown
// onchange handlers firing close together) can both append sections into
// whatever #gameReportBody instance happens to be current when each
// resumes, producing duplicated/corrupted DOM.
let renderGeneration = 0;

function currentSetNumber(sets) {
  for (let n = 1; n <= 99; n++) {
    const set = sets.find((s) => s.set_number === n);
    if (!set || !set.winner_team_id) return n;
  }
  return 1;
}

function setsWonPerTeam(sets, match) {
  let wonA = 0, wonB = 0;
  for (const s of sets) {
    if (s.winner_team_id === match.team_a_id) wonA++;
    if (s.winner_team_id === match.team_b_id) wonB++;
  }
  return { wonA, wonB };
}

async function renderHeader(match, myGeneration) {
  const referees = await listRefereeAssignments(match.id);
  if (myGeneration !== renderGeneration) return;
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
    await renderScoringBody(match, myGeneration);
  }
}

async function renderScoringBody(match, myGeneration) {
  const sets = await listSets(match.id);
  if (myGeneration !== renderGeneration) return;
  const setNumber = currentSetNumber(sets);
  const current = sets.find((s) => s.set_number === setNumber) || { points_a: 0, points_b: 0, timeouts_a: 0, timeouts_b: 0 };
  const { wonA, wonB } = setsWonPerTeam(sets, match);
  const neededSets = Math.ceil(match.best_of / 2);
  const decided = wonA >= neededSets || wonB >= neededSets;

  const body = document.getElementById('gameReportBody');
  body.innerHTML = `
    ${decided ? `<p id="gr_decided_banner">Match entschieden (${wonA}:${wonB}) — wartet auf Freigabe durch Admin</p>` : ''}
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

  if (myGeneration !== renderGeneration) return;
  await renderCardsSection(match, myGeneration);
  if (myGeneration !== renderGeneration) return;
  await renderSubstitutionsSection(match, setNumber, myGeneration);
  if (myGeneration !== renderGeneration) return;
  await renderIncidentsSection(match, myGeneration);
}

async function renderCardsSection(match, myGeneration) {
  const [playersA, playersB, events] = await Promise.all([
    listPlayers(match.team_a_id),
    listPlayers(match.team_b_id),
    listPlayerEvents(match.id),
  ]);
  if (myGeneration !== renderGeneration) return;
  const players = [...playersA, ...playersB].filter((p) => p.role === 'player');
  const playerOptions = players.map((p) =>
    `<option value="${p.id}">${escapeHtml(p.given_name)} ${escapeHtml(p.family_name)} (#${p.jersey_number ?? '-'})</option>`
  ).join('');

  const body = document.getElementById('gameReportBody');
  body.insertAdjacentHTML('beforeend', `
    <h4>Karten</h4>
    <div id="gr_cards_list">
      ${events.map((e) =>
        `<div>${escapeHtml(e.player.given_name)} ${escapeHtml(e.player.family_name)}: ${escapeHtml(e.event_type)}</div>`
      ).join('')}
    </div>
    <form id="cardForm" class="entity-form">
      <label>Spieler<select id="card_player">${playerOptions}</select></label>
      <label>Karte
        <select id="card_type">
          <option value="Y">Gelb</option>
          <option value="YR">Gelb-Rot</option>
          <option value="R">Rot</option>
        </select>
      </label>
      <button type="submit">Erfassen</button>
    </form>
  `);

  document.getElementById('cardForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('gameReportError');
    try {
      await createPlayerEvent({
        match_id: match.id,
        player_id: document.getElementById('card_player').value,
        event_type: document.getElementById('card_type').value,
      });
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

async function renderSubstitutionsSection(match, setNumber, myGeneration) {
  const [playersA, playersB, subs] = await Promise.all([
    listPlayers(match.team_a_id),
    listPlayers(match.team_b_id),
    listSubstitutions(match.id),
  ]);
  if (myGeneration !== renderGeneration) return;
  const players = [...playersA, ...playersB].filter((p) => p.role === 'player');
  const playerOptions = players.map((p) =>
    `<option value="${p.id}" data-team="${playersA.includes(p) ? match.team_a_id : match.team_b_id}">${escapeHtml(p.given_name)} ${escapeHtml(p.family_name)}</option>`
  ).join('');

  const body = document.getElementById('gameReportBody');
  body.insertAdjacentHTML('beforeend', `
    <h4>Auswechslungen</h4>
    <div id="gr_subs_list">
      ${subs.map((s) =>
        `<div>Satz ${s.set_number}: ${escapeHtml(s.player_out.given_name)} ${escapeHtml(s.player_out.family_name)} → ${escapeHtml(s.player_in.given_name)} ${escapeHtml(s.player_in.family_name)}</div>`
      ).join('')}
    </div>
    <form id="subForm" class="entity-form">
      <label>Spieler raus<select id="sub_player_out">${playerOptions}</select></label>
      <label>Spieler rein<select id="sub_player_in">${playerOptions}</select></label>
      <button type="submit">Erfassen</button>
    </form>
  `);

  document.getElementById('subForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('gameReportError');
    try {
      const outSelect = document.getElementById('sub_player_out');
      const teamId = outSelect.selectedOptions[0].dataset.team;
      await createSubstitution({
        match_id: match.id,
        set_number: setNumber,
        team_id: teamId,
        player_out_id: outSelect.value,
        player_in_id: document.getElementById('sub_player_in').value,
      });
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

async function renderIncidentsSection(match, myGeneration) {
  const incidents = await listMatchIncidents(match.id);
  if (myGeneration !== renderGeneration) return;
  const body = document.getElementById('gameReportBody');
  body.insertAdjacentHTML('beforeend', `
    <h4>Sonstiges</h4>
    <div id="gr_incidents_list">
      ${incidents.map((i) => `<div>${escapeHtml(i.incident_type)}${i.note ? ': ' + escapeHtml(i.note) : ''}</div>`).join('')}
    </div>
    <form id="incidentForm" class="entity-form">
      <label>Typ
        <select id="incident_type">
          <option value="protest">Protest</option>
          <option value="referee_report">Schiedsrichterbericht</option>
          <option value="captain_time_violation">Zeitstrafe Kapitän</option>
          <option value="other">Sonstiges</option>
        </select>
      </label>
      <label>Notiz<input id="incident_note"></label>
      <button type="submit">Erfassen</button>
    </form>
  `);

  document.getElementById('incidentForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('gameReportError');
    try {
      await createMatchIncident({
        match_id: match.id,
        incident_type: document.getElementById('incident_type').value,
        note: document.getElementById('incident_note').value.trim(),
      });
      await selectMatch(match.id);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

async function selectMatch(matchId) {
  const myGeneration = ++renderGeneration;
  currentMatchId = matchId;
  const match = await getMatch(matchId);
  if (myGeneration !== renderGeneration) return;
  await renderHeader(match, myGeneration);
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
