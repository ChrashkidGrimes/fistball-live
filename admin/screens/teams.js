import { registerScreen } from '../app.js';
import { listTournaments, listCategories, listTeams, createTeam, deleteTeam, escapeHtml } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Teams</h2>
    <div id="teamTableWrap"></div>
    <form id="teamForm" class="entity-form">
      <label>Turnier<select id="team_tournament">${tOptions}</select></label>
      <label>Kategorie<select id="team_category"></select></label>
      <label>Name<input id="team_name" required></label>
      <label>Kurzname<input id="team_short_name"></label>
      <button type="submit">Anlegen</button>
      <p id="teamError" class="error" hidden></p>
    </form>
  `;

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('team_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function renderTable(categoryId) {
    const teams = categoryId ? await listTeams(categoryId) : [];
    document.getElementById('teamTableWrap').innerHTML = `
      <table><thead><tr><th>Name</th><th>Kurzname</th><th></th></tr></thead>
      <tbody>${teams.map((t) =>
        `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.short_name || '')}</td><td><button data-delete="${t.id}">Löschen</button></td></tr>`
      ).join('')}</tbody></table>`;
    document.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('teamError');
        try {
          await deleteTeam(btn.dataset.delete);
          await renderTable(categoryId);
        } catch (err) {
          errorEl.textContent = `Löschen fehlgeschlagen (vermutlich noch mit Matches verknüpft): ${err.message}`;
          errorEl.hidden = false;
        }
      };
    });
  }

  document.getElementById('team_tournament').onchange = async (e) => {
    const categories = await refreshCategories(e.target.value);
    if (categories[0]) await renderTable(categories[0].id);
  };
  document.getElementById('team_category').onchange = (e) => renderTable(e.target.value);

  document.getElementById('teamForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('teamError');
    try {
      const categoryId = document.getElementById('team_category').value;
      await createTeam({
        category_id: categoryId,
        name: document.getElementById('team_name').value.trim(),
        short_name: document.getElementById('team_short_name').value.trim(),
      });
      await renderTable(categoryId);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  if (tournaments[0]) {
    const categories = await refreshCategories(tournaments[0].id);
    if (categories[0]) await renderTable(categories[0].id);
  }
}

registerScreen('teams', { render });
