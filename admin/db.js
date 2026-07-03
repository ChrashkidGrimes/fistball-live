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
    .select(`
      id, status, round_label, best_of, team_a_id, team_b_id, winner_team_id,
      team_a:team_a_id(name), team_b:team_b_id(name), court:court_id(name),
      team_a_source_outcome, team_a_source_match:team_a_source_match_id(sheet_match_nr, round_label),
      team_b_source_outcome, team_b_source_match:team_b_source_match_id(sheet_match_nr, round_label)
    `)
    .eq('category_id', categoryId)
    .order('scheduled_time');
  if (error) throw error;
  return data;
}

export async function createMatch({
  category_id, team_a_id, team_b_id, team_a_source_match_id, team_a_source_outcome,
  team_b_source_match_id, team_b_source_outcome, court_id, round_label, best_of,
}) {
  const { error } = await getClient().from('matches').insert({
    category_id,
    team_a_id: team_a_id || null,
    team_b_id: team_b_id || null,
    team_a_source_match_id: team_a_source_match_id || null,
    team_a_source_outcome: team_a_source_outcome || null,
    team_b_source_match_id: team_b_source_match_id || null,
    team_b_source_outcome: team_b_source_outcome || null,
    court_id: court_id || null,
    round_label: round_label || null,
    best_of: best_of || 5,
  });
  if (error) throw error;
}

export async function listMatchSourceOptions(tournamentId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, sheet_match_nr, round_label, team_a:team_a_id(name), team_b:team_b_id(name), categories!inner(tournament_id)')
    .eq('categories.tournament_id', tournamentId);
  if (error) throw error;
  return data;
}

export async function finishMatch(id, winnerTeamIdOverride) {
  const { error } = await getClient().rpc('finish_match', {
    p_match_id: id,
    p_winner_team_id_override: winnerTeamIdOverride || null,
  });
  if (error) throw error;
}

export async function startMatch(id) {
  const { error } = await getClient().rpc('start_match', { p_match_id: id });
  if (error) throw error;
}

export async function listPlayers(teamId) {
  const { data, error } = await getClient().from('players').select().eq('team_id', teamId).order('jersey_number');
  if (error) throw error;
  return data;
}

export async function createPlayer({ team_id, family_name, given_name, jersey_number, role, player_position, staff_role }) {
  const { error } = await getClient().from('players').insert({
    team_id, family_name, given_name,
    jersey_number: jersey_number || null,
    role,
    player_position: player_position || null,
    staff_role: staff_role || null,
  });
  if (error) throw error;
}

export async function deletePlayer(id) {
  const { error } = await getClient().from('players').delete().eq('id', id);
  if (error) throw error;
}

export async function getMatch(matchId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, status, best_of, round_label, team_a_id, team_b_id, team_a:team_a_id(id, name), team_b:team_b_id(id, name), court:court_id(name)')
    .eq('id', matchId)
    .single();
  if (error) throw error;
  return data;
}

export async function listRefereeAssignments(matchId) {
  const { data, error } = await getClient()
    .from('referee_assignments')
    .select('referee_name, role')
    .eq('match_id', matchId);
  if (error) throw error;
  return data;
}

export async function listSets(matchId) {
  const { data, error } = await getClient().from('sets').select().eq('match_id', matchId).order('set_number');
  if (error) throw error;
  return data;
}

export async function recordPoint(matchId, setNumber, team) {
  const { error } = await getClient().rpc('record_point', { p_match_id: matchId, p_set_number: setNumber, p_team: team });
  if (error) throw error;
}

export async function undoLastPoint(matchId, setNumber) {
  const { error } = await getClient().rpc('undo_last_point', { p_match_id: matchId, p_set_number: setNumber });
  if (error) throw error;
}

export async function recordTimeout(matchId, setNumber, team) {
  const { error } = await getClient().rpc('record_timeout', { p_match_id: matchId, p_set_number: setNumber, p_team: team });
  if (error) throw error;
}

export async function tagLastPoint(matchId, setNumber, detail) {
  const { error } = await getClient().rpc('tag_last_point', { p_match_id: matchId, p_set_number: setNumber, p_detail: detail });
  if (error) throw error;
}

export async function createPlayerEvent({ match_id, player_id, event_type }) {
  const { error } = await getClient().from('player_events').insert({ match_id, player_id, event_type });
  if (error) throw error;
}

export async function listPlayerEvents(matchId) {
  const { data, error } = await getClient()
    .from('player_events')
    .select('id, event_type, created_at, player:player_id(family_name, given_name, jersey_number)')
    .eq('match_id', matchId)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function createSubstitution({ match_id, set_number, team_id, player_out_id, player_in_id }) {
  const { error } = await getClient().from('substitutions').insert({ match_id, set_number, team_id, player_out_id, player_in_id });
  if (error) throw error;
}

export async function listSubstitutions(matchId) {
  const { data, error } = await getClient()
    .from('substitutions')
    .select('id, set_number, created_at, player_out:player_out_id(family_name, given_name), player_in:player_in_id(family_name, given_name)')
    .eq('match_id', matchId)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function createMatchIncident({ match_id, incident_type, team_id, note }) {
  const { error } = await getClient().from('match_incidents').insert({
    match_id, incident_type, team_id: team_id || null, note: note || null,
  });
  if (error) throw error;
}

export async function listMatchIncidents(matchId) {
  const { data, error } = await getClient().from('match_incidents').select().eq('match_id', matchId).order('created_at');
  if (error) throw error;
  return data;
}

export async function listMatchesForTournament(tournamentId) {
  const { data, error } = await getClient()
    .from('matches')
    .select('id, category_id, team_a_id, team_b_id, court_id, scheduled_time, categories!inner(tournament_id)')
    .eq('categories.tournament_id', tournamentId);
  if (error) throw error;
  return data;
}

export async function createMatches(rows) {
  const { error } = await getClient().from('matches').insert(rows);
  if (error) throw error;
}

export async function deleteMatchesByCategory(categoryId) {
  const { error } = await getClient().from('matches').delete().eq('category_id', categoryId);
  if (error) throw error;
}
