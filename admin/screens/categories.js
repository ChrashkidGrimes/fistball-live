import { registerScreen } from '../app.js';
import { listTournaments, listCategories, createCategory, escapeHtml } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const options = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Kategorien</h2>
    <label>Turnier
      <select id="categoryTournamentSelect">${options}</select>
    </label>
    <div id="categoryTableWrap"></div>
    <form id="categoryForm" class="entity-form">
      <label>Turnier<select id="c_tournament">${options}</select></label>
      <label>Name<input id="c_name" required></label>
      <label>Format
        <select id="c_format">
          <option value="round_robin">Round Robin</option>
          <option value="knockout">Knockout</option>
        </select>
      </label>
      <button type="submit">Anlegen</button>
      <p id="categoryError" class="error" hidden></p>
    </form>
  `;

  async function renderTable(tournamentId) {
    const categories = tournamentId ? await listCategories(tournamentId) : [];
    document.getElementById('categoryTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Format</th></tr></thead>
        <tbody>${categories.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.format)}</td></tr>`).join('')}</tbody>
      </table>`;
  }

  document.getElementById('categoryTournamentSelect').onchange = (e) => renderTable(e.target.value);

  document.getElementById('categoryForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('categoryError');
    errorEl.hidden = true;
    try {
      const tournamentId = document.getElementById('c_tournament').value;
      await createCategory({
        tournament_id: tournamentId,
        name: document.getElementById('c_name').value.trim(),
        format: document.getElementById('c_format').value,
      });
      document.getElementById('categoryTournamentSelect').value = tournamentId;
      await renderTable(tournamentId);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  if (tournaments[0]) await renderTable(tournaments[0].id);
}

registerScreen('categories', { render });
