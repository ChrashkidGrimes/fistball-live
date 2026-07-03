import { registerScreen } from '../app.js';
import { escapeHtml, listTournaments, listCategories, listTeams, listPlayers, createPlayer, deletePlayer } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Kader</h2>
    <label>Turnier<select id="player_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="player_category"></select></label>
    <label>Team<select id="player_team"></select></label>
    <div id="playerTableWrap"></div>
    <form id="playerForm" class="entity-form">
      <label>Nachname<input id="player_family_name" required></label>
      <label>Vorname<input id="player_given_name" required></label>
      <label>Rolle
        <select id="player_role">
          <option value="player">Spieler</option>
          <option value="staff">Staff</option>
        </select>
      </label>
      <label>Rückennummer<input id="player_jersey_number" type="number"></label>
      <label>Position (Spieler)<input id="player_position"></label>
      <label>Staff-Rolle<input id="player_staff_role"></label>
      <button type="submit">Anlegen</button>
      <p id="playerError" class="error" hidden></p>
    </form>
  `;

  let currentTeamId = null;

  async function renderTable() {
    const players = currentTeamId ? await listPlayers(currentTeamId) : [];
    document.getElementById('playerTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Nr</th><th>Name</th><th>Rolle</th><th>Position/Staff-Rolle</th><th></th></tr></thead>
        <tbody>${players.map((p) => `
          <tr>
            <td>${p.jersey_number ?? ''}</td>
            <td>${escapeHtml(p.given_name)} ${escapeHtml(p.family_name)}</td>
            <td>${p.role === 'player' ? 'Spieler' : 'Staff'}</td>
            <td>${escapeHtml(p.player_position || p.staff_role || '')}</td>
            <td><button data-delete="${p.id}">Löschen</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('playerError');
        try {
          await deletePlayer(btn.dataset.delete);
          await renderTable();
        } catch (err) {
          errorEl.textContent = `Löschen fehlgeschlagen (vermutlich noch mit Karten/Wechseln verknüpft): ${err.message}`;
          errorEl.hidden = false;
        }
      };
    });
  }

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('player_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshTeams(categoryId) {
    const teams = await listTeams(categoryId);
    document.getElementById('player_team').innerHTML =
      teams.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    return teams;
  }

  async function selectFirstTeamAndRender(categoryId) {
    const teams = await refreshTeams(categoryId);
    currentTeamId = teams[0]?.id || null;
    await renderTable();
  }

  document.getElementById('player_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) await selectFirstTeamAndRender(categories[0].id);
  };
  document.getElementById('player_category').onchange = async (e) => {
    await selectFirstTeamAndRender(e.target.value);
  };
  document.getElementById('player_team').onchange = async (e) => {
    currentTeamId = e.target.value;
    await renderTable();
  };

  document.getElementById('playerForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('playerError');
    try {
      await createPlayer({
        team_id: currentTeamId,
        family_name: document.getElementById('player_family_name').value.trim(),
        given_name: document.getElementById('player_given_name').value.trim(),
        jersey_number: document.getElementById('player_jersey_number').value || null,
        role: document.getElementById('player_role').value,
        player_position: document.getElementById('player_position').value.trim(),
        staff_role: document.getElementById('player_staff_role').value.trim(),
      });
      await renderTable();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) await selectFirstTeamAndRender(categories[0].id);
  }
}

registerScreen('players', { render });
