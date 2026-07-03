import { registerScreen } from '../app.js';
import {
  listTournaments, listCategories, listTeams, listCourts, listMatches, listMatchesForTournament,
  createMatches, deleteMatchesByCategory, escapeHtml,
} from '../db.js';
import { computeRoundRobinRounds, assignScheduleSlots } from '../schedule-generator.js';

async function render(main, { role }) {
  if (role !== 'admin') {
    main.innerHTML = '<p>Nur für Admin verfügbar.</p>';
    return;
  }

  const tournaments = await listTournaments();
  const tOptions = tournaments.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  main.innerHTML = `
    <h2>Spielplan — Gruppenphase generieren</h2>
    <label>Turnier<select id="sg_tournament">${tOptions}</select></label>
    <label>Kategorie<select id="sg_category"></select></label>
    <fieldset id="sg_courts"><legend>Courts</legend></fieldset>
    <label>Start<input id="sg_start" type="datetime-local"></label>
    <label>Ende<input id="sg_end" type="datetime-local"></label>
    <label>Match-Dauer (Min)<input id="sg_duration" type="number" value="40"></label>
    <label>Pause (Min)<input id="sg_break" type="number" value="5"></label>
    <label>Rundenbezeichnung<input id="sg_round_label" value="Qualification round"></label>
    <label>Best of<input id="sg_best_of" type="number" value="5"></label>
    <button id="sg_preview">Vorschau berechnen</button>
    <p id="sgError" class="error" hidden></p>
    <div id="sg_preview_wrap"></div>
  `;

  let currentTournamentId = null;
  let currentCategoryId = null;
  let previewAssignments = null;

  async function refreshCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('sg_category').innerHTML =
      categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
    return categories;
  }

  async function refreshCourts(tournamentId) {
    const courts = await listCourts(tournamentId);
    document.getElementById('sg_courts').innerHTML = '<legend>Courts</legend>' + courts.map((c) =>
      `<label><input type="checkbox" value="${c.id}" checked> ${escapeHtml(c.name)}</label>`).join('');
  }

  async function selectTournament(tournamentId) {
    currentTournamentId = tournamentId;
    const categories = await refreshCategories(tournamentId);
    await refreshCourts(tournamentId);
    if (categories[0]) currentCategoryId = categories[0].id;
  }

  document.getElementById('sg_tournament').onchange = (e) => selectTournament(e.target.value);
  document.getElementById('sg_category').onchange = (e) => { currentCategoryId = e.target.value; };

  if (tournaments[0]) await selectTournament(tournaments[0].id);

  document.getElementById('sg_preview').onclick = async () => {
    const errorEl = document.getElementById('sgError');
    errorEl.hidden = true;
    previewAssignments = null;
    document.getElementById('sg_preview_wrap').innerHTML = '';
    try {
      const courtIds = [...document.querySelectorAll('#sg_courts input:checked')].map((el) => el.value);
      if (courtIds.length === 0) throw new Error('Mindestens ein Court auswählen.');
      const start = document.getElementById('sg_start').value;
      const end = document.getElementById('sg_end').value;
      if (!start || !end) throw new Error('Start und Ende angeben.');
      const duration = Number(document.getElementById('sg_duration').value) || 0;
      const breakMin = Number(document.getElementById('sg_break').value) || 0;
      const roundLabel = document.getElementById('sg_round_label').value.trim();
      const bestOf = Number(document.getElementById('sg_best_of').value) || 5;

      const [teams, existingCategoryMatches, allTournamentMatches] = await Promise.all([
        listTeams(currentCategoryId),
        listMatches(currentCategoryId),
        listMatchesForTournament(currentTournamentId),
      ]);
      if (teams.length < 2) throw new Error('Kategorie braucht mindestens 2 Teams.');

      const existingForCollision = allTournamentMatches.filter((m) => m.category_id !== currentCategoryId);
      const rounds = computeRoundRobinRounds(teams.map((t) => t.id));
      const result = assignScheduleSlots({
        rounds, courtIds,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        matchDurationMinutes: duration,
        breakMinutes: breakMin,
        existingMatches: existingForCollision,
      });
      if (!result.ok) throw new Error(`${result.missingSlots} Paarung(en) passen nicht in den gewählten Zeitraum/Courts.`);

      const teamName = Object.fromEntries(teams.map((t) => [t.id, t.name]));
      const courtName = Object.fromEntries(
        [...document.querySelectorAll('#sg_courts input')].map((el) => [el.value, el.closest('label').textContent.trim()]),
      );
      previewAssignments = result.assignments.map((a) => ({
        ...a, round_label: roundLabel, best_of: bestOf, category_id: currentCategoryId,
      }));

      const existingCount = existingCategoryMatches.length;
      const nonScheduled = existingCategoryMatches.filter((m) => m.status !== 'scheduled');
      const warning = existingCount > 0
        ? `<p>${existingCount} bestehende Matches in dieser Kategorie werden ersetzt.</p>
           <label><input type="checkbox" id="sg_confirm_replace"> Ja, ersetzen</label>`
        : '';
      const blocked = nonScheduled.length > 0
        ? `<p class="error">${nonScheduled.length} bestehende Matches sind bereits live/finished — Regenerierung nicht möglich.</p>`
        : '';

      document.getElementById('sg_preview_wrap').innerHTML = `
        ${warning}${blocked}
        <table>
          <thead><tr><th>Team A</th><th>Team B</th><th>Court</th><th>Zeit</th></tr></thead>
          <tbody>${previewAssignments.map((a) => `
            <tr>
              <td>${escapeHtml(teamName[a.teamA])}</td>
              <td>${escapeHtml(teamName[a.teamB])}</td>
              <td>${escapeHtml(courtName[a.courtId] || '')}</td>
              <td>${new Date(a.scheduledTime).toLocaleString('de-CH')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        ${blocked ? '' : `<button id="sg_commit">Anlegen</button>`}
      `;

      if (!blocked) {
        document.getElementById('sg_commit').onclick = async () => {
          try {
            if (existingCount > 0) {
              const confirmBox = document.getElementById('sg_confirm_replace');
              if (!confirmBox.checked) throw new Error('Bitte das Ersetzen bestätigen.');
              await deleteMatchesByCategory(currentCategoryId);
            }
            await createMatches(previewAssignments.map((a) => ({
              category_id: a.category_id,
              team_a_id: a.teamA,
              team_b_id: a.teamB,
              court_id: a.courtId,
              scheduled_time: a.scheduledTime,
              round_label: a.round_label,
              best_of: a.best_of,
            })));
            document.getElementById('sg_preview_wrap').innerHTML = '<p>Spielplan angelegt.</p>';
            previewAssignments = null;
          } catch (err) {
            errorEl.textContent = err.message;
            errorEl.hidden = false;
          }
        };
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

registerScreen('schedule', { render });
