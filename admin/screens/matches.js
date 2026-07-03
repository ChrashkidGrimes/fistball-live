import { registerScreen } from '../app.js';
import {
  listTournaments, listCategories, listTeams, listCourts, listMatches, listMatchSourceOptions,
  createMatch, finishMatch, escapeHtml,
} from '../db.js';

function sourceLabel(sourceMatch, outcome) {
  if (!sourceMatch) return '—';
  const label = sourceMatch.sheet_match_nr ? `#${sourceMatch.sheet_match_nr}` : (sourceMatch.round_label || 'Match');
  return outcome === 'winner' ? `Sieger von ${label}` : `Verlierer von ${label}`;
}

async function render(main, { role }) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Matches</h2>
    <label>Turnier<select id="match_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="match_category"></select></label>
    <div id="matchTableWrap"></div>
    <p id="matchListError" class="error" hidden></p>
    <form id="matchForm" class="entity-form">
      <label>Team-A-Modus
        <select id="match_team_a_mode">
          <option value="fixed">Festes Team</option>
          <option value="winner">Sieger von Match</option>
          <option value="loser">Verlierer von Match</option>
        </select>
      </label>
      <label>Team A<select id="match_team_a"></select></label>
      <label>Team A — Quell-Match<select id="match_team_a_source"></select></label>
      <label>Team-B-Modus
        <select id="match_team_b_mode">
          <option value="fixed">Festes Team</option>
          <option value="winner">Sieger von Match</option>
          <option value="loser">Verlierer von Match</option>
        </select>
      </label>
      <label>Team B<select id="match_team_b"></select></label>
      <label>Team B — Quell-Match<select id="match_team_b_source"></select></label>
      <label>Court<select id="match_court"></select></label>
      <label>Runde<input id="match_round"></label>
      <label>Best of<input id="match_best_of" type="number" value="5"></label>
      <button type="submit">Anlegen</button>
      <p id="matchError" class="error" hidden></p>
    </form>
  `;

  let currentTournamentId = null;
  let currentCategoryId = null;

  // Selects that get their <option> lists rewritten (via .innerHTML) by the
  // tournament/category refresh chain below. Rewriting innerHTML resets the
  // selected value back to the first option, so if a user picks a value
  // while an earlier refresh is still in flight, the late-arriving refresh
  // can silently clobber their choice (e.g. team_a === team_b, or the wrong
  // source match wired into a bracket slot) with no error shown. Disabling
  // these selects for the duration of each refresh chain closes that
  // window: the user simply can't interact with a select until it holds
  // options for the tournament/category that's actually current, and
  // Playwright's own actionability checks wait for re-enablement rather
  // than racing against it.
  const RACE_GUARDED_SELECT_IDS = [
    'match_tournament', 'match_category',
    'match_team_a', 'match_team_a_source',
    'match_team_b', 'match_team_b_source',
    'match_court',
  ];
  function setRaceGuardedSelectsDisabled(disabled) {
    for (const id of RACE_GUARDED_SELECT_IDS) {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    }
  }

  function toggleSourceFields() {
    const aMode = document.getElementById('match_team_a_mode').value;
    document.getElementById('match_team_a').closest('label').hidden = aMode !== 'fixed';
    document.getElementById('match_team_a_source').closest('label').hidden = aMode === 'fixed';
    const bMode = document.getElementById('match_team_b_mode').value;
    document.getElementById('match_team_b').closest('label').hidden = bMode !== 'fixed';
    document.getElementById('match_team_b_source').closest('label').hidden = bMode === 'fixed';
  }
  document.getElementById('match_team_a_mode').onchange = toggleSourceFields;
  document.getElementById('match_team_b_mode').onchange = toggleSourceFields;
  toggleSourceFields();

  async function renderTable() {
    const matches = currentCategoryId ? await listMatches(currentCategoryId) : [];
    document.getElementById('matchTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Team A</th><th>Team B</th><th>Runde</th><th>Court</th><th>Status</th><th></th></tr></thead>
        <tbody>${matches.map((m) => `
          <tr>
            <td>${m.team_a ? escapeHtml(m.team_a.name) : `<em>${escapeHtml(sourceLabel(m.team_a_source_match, m.team_a_source_outcome))}</em>`}</td>
            <td>${m.team_b ? escapeHtml(m.team_b.name) : `<em>${escapeHtml(sourceLabel(m.team_b_source_match, m.team_b_source_outcome))}</em>`}</td>
            <td>${escapeHtml(m.round_label ?? '')}</td>
            <td>${escapeHtml(m.court?.name ?? '')}</td>
            <td>${escapeHtml(m.status)}</td>
            <td>${role === 'admin' && m.status !== 'finished' && m.team_a_id && m.team_b_id
              ? `<button data-finish="${m.id}">Finished</button>
                 <button data-forfeit-toggle="${m.id}">Forfeit</button>
                 <span id="forfeit-${m.id}" hidden>
                   <button data-forfeit-winner="${m.id}|${m.team_a_id}">${escapeHtml(m.team_a.name)} gewinnt</button>
                   <button data-forfeit-winner="${m.id}|${m.team_b_id}">${escapeHtml(m.team_b.name)} gewinnt</button>
                 </span>`
              : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    const listErrorEl = document.getElementById('matchListError');
    document.querySelectorAll('[data-finish]').forEach((btn) => {
      btn.onclick = async () => {
        listErrorEl.hidden = true;
        try {
          await finishMatch(btn.dataset.finish);
          await renderTable();
        } catch (err) {
          listErrorEl.textContent = err.message;
          listErrorEl.hidden = false;
        }
      };
    });
    document.querySelectorAll('[data-forfeit-toggle]').forEach((btn) => {
      btn.onclick = () => {
        const span = document.getElementById(`forfeit-${btn.dataset.forfeitToggle}`);
        span.hidden = !span.hidden;
      };
    });
    document.querySelectorAll('[data-forfeit-winner]').forEach((btn) => {
      btn.onclick = async () => {
        const [matchId, winnerId] = btn.dataset.forfeitWinner.split('|');
        listErrorEl.hidden = true;
        try {
          await finishMatch(matchId, winnerId);
          await renderTable();
        } catch (err) {
          listErrorEl.textContent = err.message;
          listErrorEl.hidden = false;
        }
      };
    });
  }

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('match_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshTeamsAndCourts(tournamentId, categoryId) {
    const [teams, courts] = await Promise.all([listTeams(categoryId), listCourts(tournamentId)]);
    document.getElementById('match_team_a').innerHTML = teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    document.getElementById('match_team_b').innerHTML = teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    document.getElementById('match_court').innerHTML =
      `<option value="">—</option>` + courts.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  }

  async function refreshSourceOptions(tournamentId) {
    const options = await listMatchSourceOptions(tournamentId);
    const html = options.map((m) => {
      const label = m.sheet_match_nr ? `#${m.sheet_match_nr}` : (m.round_label || m.id);
      return `<option value="${m.id}">${escapeHtml(label)} (${escapeHtml(m.team_a?.name ?? '?')} vs ${escapeHtml(m.team_b?.name ?? '?')})</option>`;
    }).join('');
    document.getElementById('match_team_a_source').innerHTML = html;
    document.getElementById('match_team_b_source').innerHTML = html;
  }

  async function selectCategory(tournamentId, categoryId) {
    currentCategoryId = categoryId;
    await refreshTeamsAndCourts(tournamentId, categoryId);
    await renderTable();
  }

  document.getElementById('match_tournament').onchange = async (e) => {
    currentTournamentId = e.target.value;
    setRaceGuardedSelectsDisabled(true);
    try {
      await refreshSourceOptions(currentTournamentId);
      const categories = await refreshCategories(currentTournamentId);
      if (categories[0]) await selectCategory(currentTournamentId, categories[0].id);
    } finally {
      setRaceGuardedSelectsDisabled(false);
    }
  };
  document.getElementById('match_category').onchange = async (e) => {
    setRaceGuardedSelectsDisabled(true);
    try {
      await selectCategory(currentTournamentId, e.target.value);
    } finally {
      setRaceGuardedSelectsDisabled(false);
    }
  };

  document.getElementById('matchForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('matchError');
    try {
      const aMode = document.getElementById('match_team_a_mode').value;
      const bMode = document.getElementById('match_team_b_mode').value;
      await createMatch({
        category_id: currentCategoryId,
        team_a_id: aMode === 'fixed' ? document.getElementById('match_team_a').value : null,
        team_a_source_match_id: aMode === 'fixed' ? null : document.getElementById('match_team_a_source').value,
        team_a_source_outcome: aMode === 'fixed' ? null : aMode,
        team_b_id: bMode === 'fixed' ? document.getElementById('match_team_b').value : null,
        team_b_source_match_id: bMode === 'fixed' ? null : document.getElementById('match_team_b_source').value,
        team_b_source_outcome: bMode === 'fixed' ? null : bMode,
        court_id: document.getElementById('match_court').value,
        round_label: document.getElementById('match_round').value.trim(),
        best_of: Number(document.getElementById('match_best_of').value) || 5,
      });
      await renderTable();
      setRaceGuardedSelectsDisabled(true);
      try {
        await refreshSourceOptions(currentTournamentId);
      } finally {
        setRaceGuardedSelectsDisabled(false);
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  if (tournaments[0]) {
    currentTournamentId = tournaments[0].id;
    setRaceGuardedSelectsDisabled(true);
    try {
      await refreshSourceOptions(currentTournamentId);
      const categories = await refreshCategories(currentTournamentId);
      if (categories[0]) await selectCategory(currentTournamentId, categories[0].id);
    } finally {
      setRaceGuardedSelectsDisabled(false);
    }
  }
}

registerScreen('matches', { render });
