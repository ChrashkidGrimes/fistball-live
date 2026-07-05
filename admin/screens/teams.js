import { registerScreen, showScreen } from '../app.js';
import { listTeams, createTeam, deleteTeam } from '../db.js';
import { dataTable, raw, emptyState, confirmDelete, showToast, escapeHtml } from '../ui.js';
import { getCategoryId } from '../context.js';

async function render(main) {
  const categoryId = getCategoryId();
  if (!categoryId) {
    main.innerHTML = `<h2>Teams</h2>${emptyState('Wähle oben Turnier und Kategorie (bzw. lege sie zuerst an).')}`;
    return;
  }
  const teams = await listTeams(categoryId);
  main.innerHTML = `
    <h2>Teams</h2>
    <div class="panel">
      ${dataTable({
        columns: [
          { label: 'Name', render: (t) => t.name },
          { label: 'Kurzname', render: (t) => t.short_name || '' },
          { label: '', render: (t) => raw(`<button class="btn btn--ghost" data-delete="${escapeHtml(t.id)}">Löschen</button>`) },
        ],
        rows: teams,
        emptyText: 'Noch keine Teams in dieser Kategorie.',
      })}
      <form id="teamForm" class="entity-form">
        <label>Name<input id="team_name" required></label>
        <label>Kurzname<input id="team_short_name"></label>
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;

  main.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!await confirmDelete('Team wirklich löschen?')) return;
      try {
        await deleteTeam(btn.dataset.delete);
        await showScreen('teams');
      } catch (err) {
        showToast(`Löschen fehlgeschlagen (vermutlich noch mit Matches verknüpft): ${err.message}`, { type: 'error' });
      }
    };
  });

  document.getElementById('teamForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createTeam({
        category_id: categoryId,
        name: document.getElementById('team_name').value.trim(),
        short_name: document.getElementById('team_short_name').value.trim(),
      });
      showToast('Team angelegt.');
      await showScreen('teams');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('teams', { render });
