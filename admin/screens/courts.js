import { registerScreen } from '../app.js';
import { listTournaments, listCourts, createCourt, escapeHtml } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  const options = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Courts</h2>
    <div id="courtTableWrap"></div>
    <form id="courtForm" class="entity-form">
      <label>Turnier<select id="court_tournament">${options}</select></label>
      <label>Name<input id="court_name" required></label>
      <button type="submit">Anlegen</button>
      <p id="courtError" class="error" hidden></p>
    </form>
  `;

  async function renderTable(tournamentId) {
    const courts = tournamentId ? await listCourts(tournamentId) : [];
    document.getElementById('courtTableWrap').innerHTML = `
      <table><thead><tr><th>Name</th></tr></thead>
      <tbody>${courts.map((c) => `<tr><td>${escapeHtml(c.name)}</td></tr>`).join('')}</tbody></table>`;
  }

  document.getElementById('court_tournament').onchange = (e) => renderTable(e.target.value);
  if (tournaments[0]) await renderTable(tournaments[0].id);

  document.getElementById('courtForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('courtError');
    try {
      const tournamentId = document.getElementById('court_tournament').value;
      await createCourt({ tournament_id: tournamentId, name: document.getElementById('court_name').value.trim() });
      await renderTable(tournamentId);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('courts', { render });
