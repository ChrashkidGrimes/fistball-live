import { registerScreen } from '../app.js';
import { listTournaments, listReferees, createReferee, deleteReferee, escapeHtml } from '../db.js';

async function render(main, { role }) {
  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Schiedsrichter</h2>
    <label>Turnier<select id="ref_tournament">${tOptions}</select></label>

    <h3>Stammdaten</h3>
    <div id="refTableWrap"></div>
    <form id="refForm" class="entity-form">
      <label>Name<input id="ref_name" required></label>
      <label>Land<input id="ref_country" required></label>
      <label>Verfügbar von<input id="ref_available_from" type="date"></label>
      <label>Verfügbar bis<input id="ref_available_to" type="date"></label>
      <button type="submit">Anlegen</button>
      <p id="refError" class="error" hidden></p>
    </form>
  `;

  let currentTournamentId = null;

  async function renderRefTable() {
    const referees = currentTournamentId ? await listReferees(currentTournamentId) : [];
    document.getElementById('refTableWrap').innerHTML = `
      <table>
        <thead><tr><th>Name</th><th>Land</th><th>Verfügbar</th><th></th></tr></thead>
        <tbody>${referees.map((r) => `
          <tr>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.country)}</td>
            <td>${r.available_from || r.available_to ? `${escapeHtml(r.available_from ?? '…')} – ${escapeHtml(r.available_to ?? '…')}` : 'ganzes Turnier'}</td>
            <td><button data-delete-ref="${r.id}">Löschen</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    document.querySelectorAll('[data-delete-ref]').forEach((btn) => {
      btn.onclick = async () => {
        const errorEl = document.getElementById('refError');
        try {
          await deleteReferee(btn.dataset.deleteRef);
          await renderRefTable();
        } catch (err) {
          errorEl.textContent = `Löschen fehlgeschlagen (vermutlich noch mit Zuweisungen verknüpft): ${err.message}`;
          errorEl.hidden = false;
        }
      };
    });
  }

  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    await renderRefTable();
  }

  document.getElementById('ref_tournament').onchange = (e) => selectTournament(e.target.value);
  if (tournaments[0]) await selectTournament(tournaments[0].id);

  document.getElementById('refForm').onsubmit = async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('refError');
    try {
      await createReferee({
        tournament_id: currentTournamentId,
        name: document.getElementById('ref_name').value.trim(),
        country: document.getElementById('ref_country').value.trim(),
        available_from: document.getElementById('ref_available_from').value,
        available_to: document.getElementById('ref_available_to').value,
      });
      document.getElementById('ref_name').value = '';
      document.getElementById('ref_country').value = '';
      await renderRefTable();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('referees', { render });
