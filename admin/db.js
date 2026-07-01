import { getClient } from './supabase-client.js';

// Shared HTML-escaping helper. All five admin/screens/*.js files render
// DB-sourced strings (tournament/category/court/team names, round labels —
// ultimately sourced from the public Google Sheet via scripts/migrate-sheet-data.mjs,
// which does no sanitization) via `innerHTML` template literals. Any such
// value MUST be passed through this function before interpolation to avoid
// stored XSS in the privileged admin session.
const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

export async function listTournaments() {
  const { data, error } = await getClient().from('tournaments').select().order('start_date');
  if (error) throw error;
  return data;
}

export async function createTournament({ name, start_date, end_date }) {
  const { error } = await getClient().from('tournaments').insert({ name, start_date, end_date });
  if (error) throw error;
}

export async function updateTournament(id, { name, start_date, end_date }) {
  const { error } = await getClient().from('tournaments').update({ name, start_date, end_date }).eq('id', id);
  if (error) throw error;
}

export async function listCategories(tournamentId) {
  const { data, error } = await getClient().from('categories').select().eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return data;
}

export async function createCategory({ tournament_id, name, format }) {
  const { error } = await getClient().from('categories').insert({ tournament_id, name, format });
  if (error) throw error;
}

export async function listCourts(tournamentId) {
  const { data, error } = await getClient().from('courts').select().eq('tournament_id', tournamentId).order('name');
  if (error) throw error;
  return data;
}

export async function createCourt({ tournament_id, name }) {
  const { error } = await getClient().from('courts').insert({ tournament_id, name });
  if (error) throw error;
}

export async function listTeams(categoryId) {
  const { data, error } = await getClient().from('teams').select().eq('category_id', categoryId).order('name');
  if (error) throw error;
  return data;
}

export async function createTeam({ category_id, name, short_name }) {
  const { error } = await getClient().from('teams').insert({ category_id, name, short_name: short_name || null });
  if (error) throw error;
}

export async function deleteTeam(id) {
  const { error } = await getClient().from('teams').delete().eq('id', id);
  if (error) throw error;
}

export async function listMatches(categoryId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, status, round_label, best_of, team_a:team_a_id(name), team_b:team_b_id(name), court:court_id(name)')
    .eq('category_id', categoryId)
    .order('scheduled_time');
  if (error) throw error;
  return data;
}

export async function createMatch({ category_id, team_a_id, team_b_id, court_id, round_label, best_of }) {
  const { error } = await getClient().from('matches').insert({
    category_id, team_a_id, team_b_id, court_id: court_id || null, round_label: round_label || null, best_of: best_of || 5,
  });
  if (error) throw error;
}

export async function finishMatch(id) {
  const { error } = await getClient().from('matches').update({ status: 'finished' }).eq('id', id);
  if (error) throw error;
}

export async function startMatch(id) {
  const { error } = await getClient().rpc('start_match', { p_match_id: id });
  if (error) throw error;
}
