import { registerScreen, showScreen } from '../app.js';
import { listCourts, createCourt } from '../db.js';
import { dataTable, emptyState, showToast } from '../ui.js';
import { getTournamentId } from '../context.js';

async function render(main) {
  const tournamentId = getTournamentId();
  if (!tournamentId) {
    main.innerHTML = `<h2>Courts</h2>${emptyState('Lege zuerst ein Turnier an (Screen „Turnier“).')}`;
    return;
  }
  const courts = await listCourts(tournamentId);
  main.innerHTML = `
    <h2>Courts</h2>
    <div class="panel">
      ${dataTable({
        columns: [{ label: 'Name', render: (c) => c.name }],
        rows: courts,
        emptyText: 'Noch keine Courts in diesem Turnier.',
      })}
      <form id="courtForm" class="entity-form">
        <label>Name<input id="court_name" required></label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;
  document.getElementById('courtForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createCourt({ tournament_id: tournamentId, name: document.getElementById('court_name').value.trim() });
      showToast('Court angelegt.');
      await showScreen('courts');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('courts', { render, context: 'tournament' });
