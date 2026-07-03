import { registerScreen } from '../app.js';
import {
  listTournaments, listCategories, listMatches, listReferees, createReferee, deleteReferee,
  listAssignmentsForMatch, createRefereeAssignment, deleteRefereeAssignment, escapeHtml,
} from '../db.js';

const KNOWN_ROLES = ['1st Referee', '2nd Referee', 'Recording Clerk', 'Assistant Referee 1', 'Assistant Referee 2'];

async function render(main, { role }) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Schiedsrichter</h2>
    <label>Turnier<select id="ref_tournament">${tOptions}</select></label>

    <h3>Stammdaten</h3>
    <div id="refTableWrap"></div>
    <form id="refForm" class="entity-form">
      <label>Name<input id="ref_name" required></label>
      <label>Land<input id="ref_country" required></label>
      <label>Verfügbar von<input id="ref_available_from" type="date"></label>
      <label>Verfügbar bis<input id="ref_available_to" type="date"></label>
      <button type="submit">Anlegen</button>
      <p id="refError" class="error" hidden></p>
    </form>

    <h3>Zuweisung</h3>
    <label>Kategorie<select id="assign_category"></select></label>
    <label>Match<select id="assign_match"></select></label>
    <div id="assignmentsWrap"></div>
    <form id="assignForm" class="entity-form">
      <label>Schiedsrichter<select id="assign_referee"></select></label>
      <label>Rolle
        <select id="assign_role_select">
          ${KNOWN_ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}
          <option value="other">Andere…</option>
        </select>
      </label>
      <label id="assign_role_custom_label" hidden>Rolle (Freitext)<input id="assign_role_custom"></label>
      <p id="assignConflictWarning" class="warning" hidden></p>
      <button type="submit">Zuweisen</button>
      <p id="assignError" class="error" hidden></p>
    </form>
  `;

  let currentTournamentId = null;
  let currentCategoryId = null;
  let currentMatchId = null;
  let currentMatches = [];
  let currentReferees = [];

  async function renderRefTable() {
    const referees = currentTournamentId ? await listReferees(currentTournamentId) : [];
    document.getElementById('refTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Land</th><th>Verfügbar</th><th></th></tr></thead>
        <tbody>${referees.map((r) => `
          <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.country)}</td>
            <td>${r.available_from || r.available_to ? `${escapeHtml(r.available_from ?? '…')} – ${escapeHtml(r.available_to ?? '…')}` : 'ganzes Turnier'}</td>
            <td><button data-delete-ref="${r.id}">Löschen</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-delete-ref]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('refError');
        try {
          await deleteReferee(btn.dataset.deleteRef);
          await renderRefTable();
        } catch (err) {
          errorEl.textContent = `Löschen fehlgeschlagen (vermutlich noch mit Zuweisungen verknüpft): ${err.message}`;
          errorEl.hidden = false;
        }
      };
    });
  }

  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    await renderRefTable();
    await refreshAssignReferees();
    const categories = await refreshAssignCategories(tournamentId);
    if (categories[0]) await selectCategoryForAssignment(categories[0].id);
  }

  document.getElementById('ref_tournament').onchange = (e) => selectTournament(e.target.value);
  if (tournaments[0]) await selectTournament(tournaments[0].id);

  document.getElementById('refForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('refError');
    try {
      await createReferee({
        tournament_id: currentTournamentId,
        name: document.getElementById('ref_name').value.trim(),
        country: document.getElementById('ref_country').value.trim(),
        available_from: document.getElementById('ref_available_from').value,
        available_to: document.getElementById('ref_available_to').value,
      });
      document.getElementById('ref_name').value = '';
      document.getElementById('ref_country').value = '';
      await renderRefTable();
      await refreshAssignReferees();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  async function refreshAssignCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('assign_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshAssignMatches(categoryId) {
    currentMatches = await listMatches(categoryId);
    document.getElementById('assign_match').innerHTML =
      currentMatches.map((m) => `<option value="${m.id}">${escapeHtml(m.round_label || '—')} (${escapeHtml(m.team_a?.name ?? '?')} vs ${escapeHtml(m.team_b?.name ?? '?')})</option>`).join('');
  }

  async function refreshAssignReferees() {
    currentReferees = currentTournamentId ? await listReferees(currentTournamentId) : [];
    document.getElementById('assign_referee').innerHTML =
      currentReferees.map((r) => `<option value="${r.id}">${escapeHtml(r.name)} (${escapeHtml(r.country)})</option>`).join('');
  }

  async function renderAssignments() {
    const assignments = currentMatchId ? await listAssignmentsForMatch(currentMatchId) : [];
    document.getElementById('assignmentsWrap').innerHTML = `
      <table>
        <thead><tr><th>Rolle</th><th>Schiedsrichter</th><th>Land</th><th></th></tr></thead>
        <tbody>${assignments.map((a) => `
          <tr>
            <td>${escapeHtml(a.role)}</td>
            <td>${escapeHtml(a.referee.name)}</td>
            <td>${escapeHtml(a.referee.country)}</td>
            <td><button data-delete-assignment="${a.id}">Löschen</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-delete-assignment]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('assignError');
        try {
          await deleteRefereeAssignment(btn.dataset.deleteAssignment);
          await renderAssignments();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
        }
      };
    });
  }

  async function selectCategoryForAssignment(categoryId) {
    currentCategoryId = categoryId;
    await refreshAssignMatches(categoryId);
    const firstMatch = currentMatches[0];
    currentMatchId = firstMatch ? firstMatch.id : null;
    await renderAssignments();
    updateConflictWarning();
  }

  document.getElementById('assign_category').onchange = (e) => selectCategoryForAssignment(e.target.value);
  document.getElementById('assign_match').onchange = (e) => {
    currentMatchId = e.target.value;
    renderAssignments();
    updateConflictWarning();
  };
  document.getElementById('assign_referee').onchange = updateConflictWarning;

  function updateConflictWarning() {
    const warningEl = document.getElementById('assignConflictWarning');
    const match = currentMatches.find((m) => m.id === currentMatchId);
    const referee = currentReferees.find((r) => r.id === document.getElementById('assign_referee').value);
    if (!match || !referee) {
      warningEl.hidden = true;
      return;
    }
    const teamAName = match.team_a?.name?.toLowerCase();
    const teamBName = match.team_b?.name?.toLowerCase();
    const refCountry = referee.country.toLowerCase();
    if (teamAName === refCountry || teamBName === refCountry) {
      warningEl.textContent = `Achtung: ${referee.name} (${referee.country}) pfeift ggf. ein Spiel des eigenen Landes.`;
      warningEl.hidden = false;
    } else {
      warningEl.hidden = true;
    }
  }

  document.getElementById('assign_role_select').onchange = (e) => {
    document.getElementById('assign_role_custom_label').hidden = e.target.value !== 'other';
  };

  await refreshAssignReferees();
  if (currentTournamentId) {
    const categories = await refreshAssignCategories(currentTournamentId);
    if (categories[0]) await selectCategoryForAssignment(categories[0].id);
  }

  document.getElementById('assignForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('assignError');
    try {
      const roleSelect = document.getElementById('assign_role_select').value;
      const role = roleSelect === 'other' ? document.getElementById('assign_role_custom').value.trim() : roleSelect;
      await createRefereeAssignment({
        match_id: currentMatchId,
        referee_id: document.getElementById('assign_referee').value,
        role,
      });
      await renderAssignments();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('referees', { render });
