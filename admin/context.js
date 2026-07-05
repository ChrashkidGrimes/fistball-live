import { listTournaments, listCategories } from './db.js';
import { selectOptions } from './ui.js';

// Global tournament/category selection shared by all screens. Persisted so
// the choice survives reloads; screens re-render via onContextChange.
const KEY_T = 'ems_tournament';
const KEY_C = 'ems_category';

let tournaments = [];
let categories = [];
let tournamentId = null;
let categoryId = null;
const listeners = [];

export function getTournamentId() { return tournamentId; }
export function getCategoryId() { return categoryId; }
export function getTournaments() { return tournaments; }
export function getCategories() { return categories; }
export function onContextChange(fn) { listeners.push(fn); }
function notify() { for (const fn of listeners) fn({ tournamentId, categoryId }); }

// Greys out the category select if the active screen doesn't use it — the bar
// itself never disappears, so the layout stays stable across screens.
export function setContextMode(mode) {
  document.getElementById('ctx_tournament').disabled = false;
  document.getElementById('ctx_category').disabled = mode !== 'category';
}

function renderSelects() {
  document.getElementById('ctx_tournament').innerHTML = tournaments.length
    ? selectOptions(tournaments, (t) => t.id, (t) => t.name, tournamentId)
    : '<option value="">— kein Turnier —</option>';
  document.getElementById('ctx_category').innerHTML = categories.length
    ? selectOptions(categories, (c) => c.id, (c) => c.name, categoryId)
    : '<option value="">—</option>';
}

async function loadCategories() {
  categories = tournamentId ? await listCategories(tournamentId) : [];
  const stored = localStorage.getItem(KEY_C);
  categoryId = categories.some((c) => c.id === stored) ? stored : (categories[0]?.id ?? null);
  if (categoryId) localStorage.setItem(KEY_C, categoryId);
  renderSelects();
}

export async function refreshContext() {
  tournaments = await listTournaments();
  if (!tournaments.some((t) => t.id === tournamentId)) {
    tournamentId = tournaments[0]?.id ?? null;
    if (tournamentId) localStorage.setItem(KEY_T, tournamentId);
  }
  await loadCategories();
}

export async function initContext() {
  tournaments = await listTournaments();
  const stored = localStorage.getItem(KEY_T);
  tournamentId = tournaments.some((t) => t.id === stored) ? stored : (tournaments[0]?.id ?? null);
  if (tournamentId) localStorage.setItem(KEY_T, tournamentId);
  await loadCategories();

  document.getElementById('ctx_tournament').onchange = async (e) => {
    tournamentId = e.target.value;
    localStorage.setItem(KEY_T, tournamentId);
    localStorage.removeItem(KEY_C); // category belongs to the old tournament
    await loadCategories();
    notify();
  };
  document.getElementById('ctx_category').onchange = (e) => {
    categoryId = e.target.value;
    localStorage.setItem(KEY_C, categoryId);
    notify();
  };
}
