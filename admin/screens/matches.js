import { registerScreen } from '../app.js';
import {
  listTeams, listCourts, listMatches, listMatchSourceOptions,
  createMatch, finishMatch,
} from '../db.js';
import { getTournamentId, getCategoryId } from '../context.js';
import { dataTable, raw, selectOptions, showToast, emptyState, escapeHtml } from '../ui.js';

function sourceLabel(sourceMatch, outcome) {
  if (!sourceMatch) return '—';
  const label = sourceMatch.sheet_match_nr ? `#${sourceMatch.sheet_match_nr}` : (sourceMatch.round_label || 'Match');
  return outcome === 'winner' ? `Sieger von ${label}` : `Verlierer von ${label}`;
}

async function render(main, { role }) {
  if (!getCategoryId()) {
    main.innerHTML = `<h2>Matches</h2>${emptyState('Wähle oben Turnier und Kategorie.')}`;
    return;
  }
  const currentTournamentId = getTournamentId();
  const currentCategoryId = getCategoryId();

  main.innerHTML = `
    <h2>Matches</h2>
    <div class="panel">
      <div id="matchTableWrap"></div>
    </div>
    <div class="panel">
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
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;

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
    document.getElementById('matchTableWrap').innerHTML = dataTable({
      columns: [
        { label: 'Team A', render: (m) => m.team_a ? m.team_a.name : raw(`<em>${escapeHtml(sourceLabel(m.team_a_source_match, m.team_a_source_outcome))}</em>`) },
        { label: 'Team B', render: (m) => m.team_b ? m.team_b.name : raw(`<em>${escapeHtml(sourceLabel(m.team_b_source_match, m.team_b_source_outcome))}</em>`) },
        { label: 'Runde', render: (m) => m.round_label ?? '' },
        { label: 'Court', render: (m) => m.court?.name ?? '' },
        { label: 'Status', render: (m) => m.status },
        { label: '', render: (m) => role === 'admin' && m.status !== 'finished' && m.team_a_id && m.team_b_id
            ? raw(`<button class="btn" data-finish="${escapeHtml(m.id)}">Finished</button>
                   <button class="btn btn--ghost" data-forfeit-toggle="${escapeHtml(m.id)}">Forfeit</button>
                   <span id="forfeit-${escapeHtml(m.id)}" hidden>
                     <button class="btn btn--danger" data-forfeit-winner="${escapeHtml(m.id)}|${escapeHtml(m.team_a_id)}">${escapeHtml(m.team_a.name)} gewinnt</button>
                     <button class="btn btn--danger" data-forfeit-winner="${escapeHtml(m.id)}|${escapeHtml(m.team_b_id)}">${escapeHtml(m.team_b.name)} gewinnt</button>
                   </span>`)
            : '' },
      ],
      rows: matches,
      emptyText: 'Noch keine Matches in dieser Kategorie.',
    });

    document.querySelectorAll('[data-finish]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await finishMatch(btn.dataset.finish);
          await renderTable();
        } catch (err) {
          showToast(err.message, { type: 'error' });
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
        try {
          await finishMatch(matchId, winnerId);
          await renderTable();
        } catch (err) {
          showToast(err.message, { type: 'error' });
        }
      };
    });
  }

  async function refreshTeamsAndCourts(tournamentId, categoryId) {
    const [teams, courts] = await Promise.all([listTeams(categoryId), listCourts(tournamentId)]);
    const teamOptions = selectOptions(teams, (t) => t.id, (t) => t.name);
    document.getElementById('match_team_a').innerHTML = teamOptions;
    document.getElementById('match_team_b').innerHTML = teamOptions;
    document.getElementById('match_court').innerHTML =
      `<option value="">—</option>` + selectOptions(courts, (c) => c.id, (c) => c.name);
  }

  async function refreshSourceOptions(tournamentId) {
    const options = await listMatchSourceOptions(tournamentId);
    const html = selectOptions(options, (m) => m.id, (m) => {
      const label = m.sheet_match_nr ? `#${m.sheet_match_nr}` : (m.round_label || m.id);
      return `${label} (${m.team_a?.name ?? '?'} vs ${m.team_b?.name ?? '?'})`;
    });
    document.getElementById('match_team_a_source').innerHTML = html;
    document.getElementById('match_team_b_source').innerHTML = html;
  }

  document.getElementById('matchForm').onsubmit = async (e) => {
    e.preventDefault();
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
      showToast(err.message, { type: 'error' });
    }
  };

  setRaceGuardedSelectsDisabled(true);
  try {
    await refreshSourceOptions(currentTournamentId);
    await refreshTeamsAndCourts(currentTournamentId, currentCategoryId);
    await renderTable();
  } finally {
    setRaceGuardedSelectsDisabled(false);
  }
}

registerScreen('matches', { render });
