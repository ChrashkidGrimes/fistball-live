import { registerScreen } from '../app.js';
import {
  listCategories, listMatches, listMatchesForTournament, listReferees, createReferee, deleteReferee,
  listAssignmentsForMatch, createRefereeAssignment, deleteRefereeAssignment,
  listAssignmentsForMatchIds, createRefereeAssignments,
} from '../db.js';
import { assignReferees } from '../referee-assignment-generator.js';
import { getTournamentId, getCategoryId } from '../context.js';
import { dataTable, raw, selectOptions, confirmDelete, showToast, emptyState, escapeHtml } from '../ui.js';

const KNOWN_ROLES = ['1st Referee', '2nd Referee', 'Recording Clerk', 'Assistant Referee 1', 'Assistant Referee 2'];

async function render(main) {
  const currentTournamentId = getTournamentId();
  if (!currentTournamentId) {
    main.innerHTML = `<h2>Schiedsrichter</h2>${emptyState('Lege zuerst ein Turnier an.')}`;
    return;
  }

  main.innerHTML = `
    <h2>Schiedsrichter</h2>

    <div class="panel">
      <h3>Stammdaten</h3>
      <div id="refTableWrap"></div>
      <form id="refForm" class="entity-form">
        <label>Name<input id="ref_name" required></label>
        <label>Land<input id="ref_country" required></label>
        <label>Verfügbar von<input id="ref_available_from" type="date"></label>
        <label>Verfügbar bis<input id="ref_available_to" type="date"></label>
        <button type="submit" class="btn">Anlegen</button>
        <p id="refError" class="error" hidden></p>
      </form>
    </div>

    <div class="panel">
      <h3>Zuweisung</h3>
      <label>Kategorie<select id="assign_category"></select></label>
      <label>Match<select id="assign_match"></select></label>
      <div id="assignmentsWrap"></div>
      <form id="assignForm" class="entity-form">
        <label>Schiedsrichter<select id="assign_referee"></select></label>
        <label>Rolle
          <select id="assign_role_select">
            ${KNOWN_ROLES.map((r) => `<option value="${r}">${r}</option>`).join('')}
            <option value="other">Andere…</option>
          </select>
        </label>
        <label id="assign_role_custom_label" hidden>Rolle (Freitext)<input id="assign_role_custom"></label>
        <p id="assignConflictWarning" class="warning" hidden></p>
        <button type="submit" class="btn">Zuweisen</button>
      </form>
    </div>

    <div class="panel">
      <h3>Automatische Zuteilung</h3>
      <fieldset id="auto_categories"><legend>Kategorien</legend></fieldset>
      <fieldset id="auto_roles"><legend>Rollen</legend>
        ${KNOWN_ROLES.map((r) => `<label><input type="checkbox" value="${r}" checked> ${r}</label>`).join('')}
      </fieldset>
      <button id="auto_preview" class="btn">Vorschau berechnen</button>
      <p id="autoError" class="error" hidden></p>
      <div id="auto_preview_wrap"></div>
    </div>

    <div class="panel">
      <h3>Workload-Übersicht</h3>
      <div id="workloadWrap"></div>
    </div>
  `;

  let currentCategoryId = null;
  let currentMatchId = null;
  let currentMatches = [];
  let currentReferees = [];
  let autoPreviewResults = null;

  async function renderRefTable() {
    const referees = await listReferees(currentTournamentId);
    document.getElementById('refTableWrap').innerHTML = dataTable({
      columns: [
        { label: 'Name', render: (r) => r.name },
        { label: 'Land', render: (r) => r.country },
        { label: 'Verfügbar', render: (r) => r.available_from || r.available_to ? `${r.available_from ?? '…'} – ${r.available_to ?? '…'}` : 'ganzes Turnier' },
        { label: '', render: (r) => raw(`<button class="btn btn--ghost" data-delete-ref="${escapeHtml(r.id)}">Löschen</button>`) },
      ],
      rows: referees,
      emptyText: 'Noch keine Schiedsrichter erfasst.',
    });
    document.querySelectorAll('[data-delete-ref]').forEach((btn) => {
      btn.onclick = async () => {
        if (!await confirmDelete('Schiedsrichter wirklich löschen?')) return;
        try {
          await deleteReferee(btn.dataset.deleteRef);
          await renderRefTable();
        } catch (err) {
          showToast(`Löschen fehlgeschlagen (vermutlich noch mit Zuweisungen verknüpft): ${err.message}`, { type: 'error' });
        }
      };
    });
  }

  // Categories/matches/referees selects are rebuilt whenever the tournament
  // context loads; the assignment section itself works across whichever
  // category is selected without needing a context change.
  async function refreshAssignCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    const contextCategoryId = getCategoryId();
    const preselected = categories.some((c) => c.id === contextCategoryId) ? contextCategoryId : categories[0]?.id ?? null;
    document.getElementById('assign_category').innerHTML = selectOptions(categories, (c) => c.id, (c) => c.name, preselected);
    return { categories, preselected };
  }

  async function refreshAssignMatches(categoryId) {
    currentMatches = await listMatches(categoryId);
    document.getElementById('assign_match').innerHTML =
      selectOptions(currentMatches, (m) => m.id, (m) => `${m.round_label || '—'} (${m.team_a?.name ?? '?'} vs ${m.team_b?.name ?? '?'})`);
  }

  async function refreshAssignReferees() {
    currentReferees = await listReferees(currentTournamentId);
    document.getElementById('assign_referee').innerHTML =
      selectOptions(currentReferees, (r) => r.id, (r) => `${r.name} (${r.country})`);
  }

  async function renderAssignments() {
    const assignments = currentMatchId ? await listAssignmentsForMatch(currentMatchId) : [];
    document.getElementById('assignmentsWrap').innerHTML = dataTable({
      columns: [
        { label: 'Rolle', render: (a) => a.role },
        { label: 'Schiedsrichter', render: (a) => a.referee.name },
        { label: 'Land', render: (a) => a.referee.country },
        { label: '', render: (a) => raw(`<button class="btn btn--ghost" data-delete-assignment="${escapeHtml(a.id)}">Löschen</button>`) },
      ],
      rows: assignments,
      emptyText: 'Keine Zuweisungen für dieses Match.',
    });
    document.querySelectorAll('[data-delete-assignment]').forEach((btn) => {
      btn.onclick = async () => {
        if (!await confirmDelete('Zuweisung wirklich löschen?')) return;
        try {
          await deleteRefereeAssignment(btn.dataset.deleteAssignment);
          await renderAssignments();
        } catch (err) {
          showToast(err.message, { type: 'error' });
        }
      };
    });
  }

  function dayKey(isoString) {
    return isoString ? isoString.slice(0, 10) : null;
  }

  async function renderWorkload() {
    const [referees, matches] = await Promise.all([
      listReferees(currentTournamentId),
      listMatchesForTournament(currentTournamentId),
    ]);
    const matchIds = matches.map((m) => m.id);
    const assignments = await listAssignmentsForMatchIds(matchIds);
    const matchById = Object.fromEntries(matches.map((m) => [m.id, m]));

    const days = [...new Set(matches.map((m) => dayKey(m.scheduled_time)).filter(Boolean))].sort();

    const countsByReferee = Object.fromEntries(referees.map((r) => [r.id, { total: 0, byDay: {} }]));
    for (const a of assignments) {
      if (!countsByReferee[a.referee_id]) continue;
      countsByReferee[a.referee_id].total++;
      const day = dayKey(matchById[a.match_id]?.scheduled_time);
      if (day) {
        countsByReferee[a.referee_id].byDay[day] = (countsByReferee[a.referee_id].byDay[day] || 0) + 1;
      }
    }

    document.getElementById('workloadWrap').innerHTML = dataTable({
      columns: [
        { label: 'Name', render: (r) => r.name },
        { label: 'Land', render: (r) => r.country },
        { label: 'Gesamt', render: (r) => countsByReferee[r.id].total },
        ...days.map((d) => ({ label: d, render: (r) => countsByReferee[r.id].byDay[d] || 0 })),
      ],
      rows: referees,
      emptyText: 'Keine Schiedsrichter erfasst.',
    });
  }

  async function selectCategoryForAssignment(categoryId) {
    currentCategoryId = categoryId;
    await refreshAssignMatches(categoryId);
    const firstMatch = currentMatches[0];
    currentMatchId = firstMatch ? firstMatch.id : null;
    await renderAssignments();
    updateConflictWarning();
  }

  function updateConflictWarning() {
    const warningEl = document.getElementById('assignConflictWarning');
    const match = currentMatches.find((m) => m.id === currentMatchId);
    const referee = currentReferees.find((r) => r.id === document.getElementById('assign_referee').value);
    if (!match || !referee) {
      warningEl.hidden = true;
      return;
    }
    const teamAName = match.team_a?.name?.toLowerCase();
    const teamBName = match.team_b?.name?.toLowerCase();
    const refCountry = referee.country.toLowerCase();
    if (teamAName === refCountry || teamBName === refCountry) {
      warningEl.textContent = `Achtung: ${referee.name} (${referee.country}) pfeift ggf. ein Spiel des eigenen Landes.`;
      warningEl.hidden = false;
    } else {
      warningEl.hidden = true;
    }
  }

  async function refreshAutoCategories(tournamentId) {
    const categories = await listCategories(tournamentId);
    document.getElementById('auto_categories').innerHTML = '<legend>Kategorien</legend>' + categories.map((c) =>
      `<label><input type="checkbox" value="${c.id}" checked> ${escapeHtml(c.name)}</label>`).join('');
  }

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
      await refreshAssignReferees();
      await renderWorkload();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  document.getElementById('assign_category').onchange = (e) => selectCategoryForAssignment(e.target.value);
  document.getElementById('assign_match').onchange = (e) => {
    currentMatchId = e.target.value;
    renderAssignments();
    updateConflictWarning();
  };
  document.getElementById('assign_referee').onchange = updateConflictWarning;

  document.getElementById('assign_role_select').onchange = (e) => {
    document.getElementById('assign_role_custom_label').hidden = e.target.value !== 'other';
  };

  document.getElementById('assignForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const roleSelect = document.getElementById('assign_role_select').value;
      const role = roleSelect === 'other' ? document.getElementById('assign_role_custom').value.trim() : roleSelect;
      await createRefereeAssignment({
        match_id: currentMatchId,
        referee_id: document.getElementById('assign_referee').value,
        role,
      });
      await renderAssignments();
      await renderWorkload();
    } catch (err) {
      showToast(err.message, { type: 'error' });
    }
  };

  document.getElementById('auto_preview').onclick = async () => {
    const errorEl = document.getElementById('autoError');
    errorEl.hidden = true;
    autoPreviewResults = null;
    document.getElementById('auto_preview_wrap').innerHTML = '';
    try {
      const categoryIds = [...document.querySelectorAll('#auto_categories input:checked')].map((el) => el.value);
      const roles = [...document.querySelectorAll('#auto_roles input:checked')].map((el) => el.value);
      if (categoryIds.length === 0) throw new Error('Mindestens eine Kategorie auswählen.');
      if (roles.length === 0) throw new Error('Mindestens eine Rolle auswählen.');

      const [allTournamentMatches, referees] = await Promise.all([
        listMatchesForTournament(currentTournamentId),
        listReferees(currentTournamentId),
      ]);
      const matches = allTournamentMatches
        .filter((m) => categoryIds.includes(m.category_id))
        .map((m) => ({
          id: m.id,
          scheduled_time: m.scheduled_time,
          team_a_name: m.team_a?.name ?? null,
          team_b_name: m.team_b?.name ?? null,
        }));
      const matchIds = allTournamentMatches.map((m) => m.id);
      const existingAssignments = await listAssignmentsForMatchIds(matchIds);

      const results = assignReferees({ matches, referees, existingAssignments, roles });
      autoPreviewResults = results;

      // Left unescaped on purpose: dataTable() escapes every plain-string
      // cell value by default, so pre-escaping here would double-escape it.
      const matchLabel = Object.fromEntries(matches.map((m) => [m.id, `${m.team_a_name ?? '?'} vs ${m.team_b_name ?? '?'}`]));
      const refereeName = Object.fromEntries(referees.map((r) => [r.id, r.name]));

      const unresolvedCount = results.filter((r) => r.refereeId === null).length;

      document.getElementById('auto_preview_wrap').innerHTML = `
        ${unresolvedCount > 0 ? `<p class="warning">${unresolvedCount} Rolle(n) konnten nicht zugeteilt werden.</p>` : ''}
        ${dataTable({
          columns: [
            { label: 'Match', render: (r) => matchLabel[r.matchId] },
            { label: 'Rolle', render: (r) => r.role },
            { label: 'Schiedsrichter', render: (r) => r.refereeId ? refereeName[r.refereeId] : '— nicht zuteilbar —' },
          ],
          rows: results,
          emptyText: 'Keine Zuteilungen berechnet.',
        })}
        <button id="auto_commit" class="btn">Anlegen</button>
      `;

      document.getElementById('auto_commit').onclick = async () => {
        try {
          const rows = autoPreviewResults
            .filter((r) => r.refereeId !== null)
            .map((r) => ({ match_id: r.matchId, referee_id: r.refereeId, role: r.role }));
          await createRefereeAssignments(rows);
          document.getElementById('auto_preview_wrap').innerHTML = '<p>Zuweisungen angelegt.</p>';
          autoPreviewResults = null;
          await renderAssignments();
          await renderWorkload();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.hidden = false;
        }
      };
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };

  async function initData() {
    await renderRefTable();
    await refreshAssignReferees();
    const { preselected } = await refreshAssignCategories(currentTournamentId);
    if (preselected) await selectCategoryForAssignment(preselected);
    await refreshAutoCategories(currentTournamentId);
    await renderWorkload();
  }

  // Initial data load — runs only after every handler above is attached,
  // so the forms are always interactive as soon as they appear in the DOM.
  await initData();
}

registerScreen('referees', { render, context: 'tournament' });
