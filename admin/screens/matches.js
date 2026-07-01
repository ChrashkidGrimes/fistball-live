import { registerScreen } from '../app.js';
import {
  listTournaments, listCategories, listTeams, listCourts, listMatches, createMatch, finishMatch,
} from '../db.js';

async function render(main, { role }) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
  main.innerHTML = `
    <h2>Matches</h2>
    <label>Turnier<select id="match_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="match_category"></select></label>
    <div id="matchTableWrap"></div>
    <form id="matchForm" class="entity-form">
      <label>Team A<select id="match_team_a"></select></label>
      <label>Team B<select id="match_team_b"></select></label>
      <label>Court<select id="match_court"></select></label>
      <label>Runde<input id="match_round"></label>
      <label>Best of<input id="match_best_of" type="number" value="5"></label>
      <button type="submit">Anlegen</button>
      <p id="matchError" class="error" hidden></p>
    </form>
  `;

  let currentCategoryId = null;

  async function renderTable() {
    const matches = currentCategoryId ? await listMatches(currentCategoryId) : [];
    document.getElementById('matchTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Team A</th><th>Team B</th><th>Court</th><th>Status</th><th></th></tr></thead>
        <tbody>${matches.map((m) => `
          <tr>
            <td>${m.team_a?.name ?? ''}</td>
            <td>${m.team_b?.name ?? ''}</td>
            <td>${m.court?.name ?? ''}</td>
            <td>${m.status}</td>
            <td>${role === 'admin' && m.status !== 'finished'
              ? `<button data-finish="${m.id}">Finished</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-finish]').forEach((btn) => {
      btn.onclick = async () => {
        await finishMatch(btn.dataset.finish);
        await renderTable();
      };
    });
  }

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('match_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    return categories;
  }

  async function refreshTeamsAndCourts(tournamentId, categoryId) {
    const [teams, courts] = await Promise.all([listTeams(categoryId), listCourts(tournamentId)]);
    document.getElementById('match_team_a').innerHTML = teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    document.getElementById('match_team_b').innerHTML = teams.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    document.getElementById('match_court').innerHTML =
      `<option value="">—</option>` + courts.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  async function selectCategory(tournamentId, categoryId) {
    currentCategoryId = categoryId;
    await refreshTeamsAndCourts(tournamentId, categoryId);
    await renderTable();
  }

  document.getElementById('match_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) await selectCategory(e.target.value, categories[0].id);
  };
  document.getElementById('match_category').onchange = (e) =>
    selectCategory(document.getElementById('match_tournament').value, e.target.value);

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) await selectCategory(tournaments[0].id, categories[0].id);
  }

  document.getElementById('matchForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('matchError');
    try {
      await createMatch({
        category_id: currentCategoryId,
        team_a_id: document.getElementById('match_team_a').value,
        team_b_id: document.getElementById('match_team_b').value,
        court_id: document.getElementById('match_court').value,
        round_label: document.getElementById('match_round').value.trim(),
        best_of: Number(document.getElementById('match_best_of').value) || 5,
      });
      await renderTable();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('matches', { render });
