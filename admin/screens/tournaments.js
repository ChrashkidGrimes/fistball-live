import { registerScreen, showScreen } from '../app.js';
import { listTournaments, createTournament } from '../db.js';
import { dataTable, showToast } from '../ui.js';
import { refreshContext, selectTournament } from '../context.js';

async function render(main) {
  const tournaments = await listTournaments();
  main.innerHTML = `
    <h2>Turniere</h2>
    <div class="panel">
      ${dataTable({
        columns: [
          { label: 'Name', render: (t) => t.name },
          { label: 'Start', render: (t) => t.start_date },
          { label: 'Ende', render: (t) => t.end_date },
        ],
        rows: tournaments,
        emptyText: 'Noch kein Turnier angelegt.',
      })}
      <form id="tournamentForm" class="entity-form">
        <label>Name<input id="t_name" required></label>
        <label>Start<input id="t_start" type="date" required></label>
        <label>Ende<input id="t_end" type="date" required></label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;
  document.getElementById('tournamentForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const row = await createTournament({
        name: document.getElementById('t_name').value.trim(),
        start_date: document.getElementById('t_start').value,
        end_date: document.getElementById('t_end').value,
      });
      await refreshContext();
      await selectTournament(row.id);
      showToast('Turnier angelegt.');
      await showScreen('tournaments');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('tournaments', { render, context: 'none' });
