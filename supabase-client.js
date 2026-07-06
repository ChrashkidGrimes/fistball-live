import { createClient } from './vendor/supabase-js-2.110.0.mjs';

// Public, read-only anon key — safe to commit, same as admin/config.js's
// production values. No login, no session: the public viewer only ever
// reads data that every RLS policy already exposes to anon.
const SUPABASE_URL = 'https://obujvbiwqspdnewetgyi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9idWp2Yml3cXNwZG5ld2V0Z3lpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NDE2NzEsImV4cCI6MjA5ODUxNzY3MX0.GX4iOpfx9fdc-YPJx7QrgKPzOvNzxdy0MOWdbKh8tfk';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getClient() {
  return client;
}

export async function fetchTournament() {
  const { data, error } = await client.from('tournaments').select('id, name, config').limit(1).single();
  if (error) throw error;
  return data;
}

export async function fetchMatches(tournamentId) {
  const { data, error } = await client
    .from('matches')
    .select(`
      id, sheet_match_nr, round_label, best_of, status, scheduled_time,
      team_a_id, team_b_id, team_a_source_outcome, team_b_source_outcome,
      team_a:team_a_id(name), team_b:team_b_id(name),
      team_a_source_match:team_a_source_match_id(sheet_match_nr, round_label),
      team_b_source_match:team_b_source_match_id(sheet_match_nr, round_label),
      court:court_id(name),
      categories!inner(name, tournament_id),
      sets(set_number, points_a, points_b, winner_team_id)
    `)
    .eq('categories.tournament_id', tournamentId)
    .order('scheduled_time');
  if (error) throw error;
  return data;
}

export async function fetchCautions(matchIds) {
  if (matchIds.length === 0) return [];
  const { data, error } = await client
    .from('player_events')
    .select(`
      event_type, player_id, match_id,
      player:player_id(family_name, given_name, jersey_number, team:team_id(name, category:category_id(name))),
      match:match_id(round_label)
    `)
    .in('match_id', matchIds);
  if (error) throw error;
  return data;
}
