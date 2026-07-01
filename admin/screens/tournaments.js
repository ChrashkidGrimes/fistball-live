import { registerScreen } from '../app.js';
import { listTournaments, createTournament, escapeHtml } from '../db.js';

async function render(main) {
  const tournaments = await listTournaments();
  main.innerHTML = `
    <h2>Turniere</h2>
    <table>
      <thead><tr><th>Name</th><th>Start</th><th>Ende</th></tr></thead>
      <tbody>${tournaments.map((t) =>
        `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.start_date)}</td><td>${escapeHtml(t.end_date)}</td></tr>`).join('')}
      </tbody>
    </table>
    <form id="tournamentForm" class="entity-form">
      <label>Name<input id="t_name" required></label>
      <label>Start<input id="t_start" type="date" required></label>
      <label>Ende<input id="t_end" type="date" required></label>
      <button type="submit">Anlegen</button>
      <p id="tournamentError" class="error" hidden></p>
    </form>
  `;
  document.getElementById('tournamentForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('tournamentError');
    try {
      await createTournament({
        name: document.getElementById('t_name').value.trim(),
        start_date: document.getElementById('t_start').value,
        end_date: document.getElementById('t_end').value,
      });
      await render(main);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('tournaments', { render });
