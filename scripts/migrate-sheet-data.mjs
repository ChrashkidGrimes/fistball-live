import { createClient } from '@supabase/supabase-js';
import { buildMigrationPlan, mapStatus } from './parse-sheet.mjs';

const SHEET_ID = '1IWuv2zOZtIJDZCFnItp_z8p546azRGlD8I052jVe8Mk';
const SCHEDULE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;

export async function migrateSheetData({
  scheduleCsvText, tournament, supabaseUrl, serviceKey, existingTournamentId,
}) {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const plan = buildMigrationPlan(scheduleCsvText);

  let tournamentId = existingTournamentId;
  if (!tournamentId) {
    const { data, error } = await supabase.from('tournaments')
      .insert(tournament).select().single();
    if (error) throw error;
    tournamentId = data.id;
  }

  const categoryIdByName = new Map();
  for (const name of plan.categories) {
    const { data, error } = await supabase.from('categories')
      .upsert({ tournament_id: tournamentId, name, format: 'round_robin' }, { onConflict: 'tournament_id,name' })
      .select().single();
    if (error) throw error;
    categoryIdByName.set(name, data.id);
  }

  const courtIdByName = new Map();
  for (const name of plan.courts) {
    const { data, error } = await supabase.from('courts')
      .upsert({ tournament_id: tournamentId, name }, { onConflict: 'tournament_id,name' })
      .select().single();
    if (error) throw error;
    courtIdByName.set(name, data.id);
  }

  const teamIdByKey = new Map();
  for (const team of plan.teams) {
    const categoryId = categoryIdByName.get(team.category);
    const { data, error } = await supabase.from('teams')
      .upsert({ category_id: categoryId, name: team.name }, { onConflict: 'category_id,name' })
      .select().single();
    if (error) throw error;
    teamIdByKey.set(`${team.category}::${team.name}`, data.id);
  }

  for (const m of plan.matches) {
    const { error } = await supabase.from('matches').upsert({
      sheet_match_nr: m.nr,
      category_id: categoryIdByName.get(m.category),
      team_a_id: teamIdByKey.get(`${m.category}::${m.teamA}`),
      team_b_id: teamIdByKey.get(`${m.category}::${m.teamB}`),
      court_id: courtIdByName.get(m.court) || null,
      scheduled_time: m.scheduledTimeIso,
      round_label: m.round,
      best_of: m.bestOf || 5,
      status: mapStatus(m.status),
    }, { onConflict: 'sheet_match_nr' });
    if (error) throw error;
  }

  return { tournamentId };
}

// CLI entrypoint — only runs when invoked directly (`node scripts/migrate-sheet-data.mjs`),
// not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)');
    process.exit(1);
  }
  const res = await fetch(SCHEDULE_URL);
  if (!res.ok) throw new Error(`Failed to fetch schedule sheet: ${res.status}`);
  const scheduleCsvText = await res.text();
  const tournament = {
    name: '2026 U18 World Championship & Womens EFA Championship',
    start_date: '2026-07-23',
    end_date: '2026-07-26',
  };

  // Look up an existing tournament by name so repeated CLI runs update the
  // same tournament instead of creating a duplicate (and orphaning the
  // previous run's categories/courts/teams/matches).
  const cliClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: existing, error: lookupError } = await cliClient
    .from('tournaments').select('id').eq('name', tournament.name).maybeSingle();
  if (lookupError) throw lookupError;

  const result = await migrateSheetData({
    scheduleCsvText,
    tournament,
    supabaseUrl: url,
    serviceKey,
    existingTournamentId: existing?.id,
  });
  console.log(`Migration complete. Tournament ID: ${result.tournamentId}`);
}
