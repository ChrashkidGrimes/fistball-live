import { registerScreen, showScreen } from '../app.js';
import { listCategories, createCategory } from '../db.js';
import { dataTable, emptyState, showToast } from '../ui.js';
import { getTournamentId, refreshContext } from '../context.js';

async function render(main) {
  const tournamentId = getTournamentId();
  if (!tournamentId) {
    main.innerHTML = `<h2>Kategorien</h2>${emptyState('Lege zuerst ein Turnier an (Screen „Turnier“).')}`;
    return;
  }
  const categories = await listCategories(tournamentId);
  main.innerHTML = `
    <h2>Kategorien</h2>
    <div class="panel">
      ${dataTable({
        columns: [
          { label: 'Name', render: (c) => c.name },
          { label: 'Format', render: (c) => c.format },
        ],
        rows: categories,
        emptyText: 'Noch keine Kategorien in diesem Turnier.',
      })}
      <form id="categoryForm" class="entity-form">
        <label>Name<input id="c_name" required></label>
        <label>Format
          <select id="c_format">
            <option value="round_robin">Round Robin</option>
            <option value="knockout">Knockout</option>
          </select>
        </label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;
  document.getElementById('categoryForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createCategory({
        tournament_id: tournamentId,
        name: document.getElementById('c_name').value.trim(),
        format: document.getElementById('c_format').value,
      });
      await refreshContext();
      showToast('Kategorie angelegt.');
      await showScreen('categories');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('categories', { render, context: 'tournament' });
