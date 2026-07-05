import { registerScreen, showScreen } from '../app.js';
import { listTeams, listPlayers, createPlayer, deletePlayer } from '../db.js';
import { dataTable, raw, selectOptions, emptyState, confirmDelete, showToast, escapeHtml } from '../ui.js';
import { getCategoryId } from '../context.js';

let lastTeamId = null;

async function render(main) {
  const categoryId = getCategoryId();
  if (!categoryId) {
    main.innerHTML = `<h2>Kader</h2>${emptyState('Wähle oben Turnier und Kategorie.')}`;
    return;
  }
  const teams = await listTeams(categoryId);
  if (!teams.length) {
    main.innerHTML = `<h2>Kader</h2>${emptyState('Noch keine Teams in dieser Kategorie — lege zuerst Teams an.')}`;
    return;
  }
  const teamId = teams.some((t) => t.id === lastTeamId) ? lastTeamId : teams[0].id;
  lastTeamId = teamId;
  const players = await listPlayers(teamId);
  main.innerHTML = `
    <h2>Kader</h2>
    <div class="panel">
      <label>Team<select id="player_team">${selectOptions(teams, (t) => t.id, (t) => t.name, teamId)}</select></label>
      ${dataTable({
        columns: [
          { label: 'Nr', render: (p) => p.jersey_number ?? '' },
          { label: 'Name', render: (p) => `${p.given_name} ${p.family_name}` },
          { label: 'Rolle', render: (p) => (p.role === 'player' ? 'Spieler' : 'Staff') },
          { label: 'Position/Staff-Rolle', render: (p) => p.player_position || p.staff_role || '' },
          { label: '', render: (p) => raw(`<button class="btn btn--ghost" data-delete="${escapeHtml(p.id)}">Löschen</button>`) },
        ],
        rows: players,
        emptyText: 'Noch keine Spieler in diesem Team.',
      })}
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
        <button type="submit" class="btn">Anlegen</button>
      </form>
    </div>
  `;

  document.getElementById('player_team').onchange = async (e) => {
    lastTeamId = e.target.value;
    await showScreen('players');
  };

  main.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = async () => {
      if (!await confirmDelete('Spieler wirklich löschen?')) return;
      try {
        await deletePlayer(btn.dataset.delete);
        await showScreen('players');
      } catch (err) {
        showToast(`Löschen fehlgeschlagen (vermutlich noch mit Karten/Wechseln verknüpft): ${err.message}`, { type: 'error' });
      }
    };
  });

  document.getElementById('playerForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await createPlayer({
        team_id: document.getElementById('player_team').value,
        family_name: document.getElementById('player_family_name').value.trim(),
        given_name: document.getElementById('player_given_name').value.trim(),
        jersey_number: document.getElementById('player_jersey_number').value || null,
        role: document.getElementById('player_role').value,
        player_position: document.getElementById('player_position').value.trim(),
        staff_role: document.getElementById('player_staff_role').value.trim(),
      });
      showToast('Spieler angelegt.');
      await showScreen('players');
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };
}

registerScreen('players', { render });
