import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { migrateSheetData } from '../scripts/migrate-sheet-data.mjs';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

const service = createClient(url, serviceKey);

const SCHEDULE_CSV = [
  '"","","","2026 U18 World Championship R E S U L T S","","","","",""',
  '"","","","","","","","","","","","","1","1","1","2","2","2","3","3","3"',
  '"","","","","","","","","","","","","","","","","","","","",""',
  '"","","","","Team A","Team B","Round","Category","","","","","","","","","","","","","","","","","","","","","","","","","","","","","Status","Remarks"',
  '"Thursday - 23 Jul  2026","10:00","16","1","Chile - U18 M Silver","India - U18 M Silver","Qualification round","U18 M Silver","5","1","x","2","1","x","2","5","x","1","2","x","4","0","x","0","0","x","0","FALSE","x","","","x","","8","|","7","Finished",""',
  '"Thursday - 23 Jul  2026","11:15","17","1","Chile - U18 M Silver","Namibia - U18 M Silver","Qualification round","U18 M Silver","5","0","x","2","0","x","2","0","x","2","0","x","0","0","x","0","0","x","0","FALSE","x","","","x","","0","|","6","Not Started",""',
].join('\n');

let tournamentId;

after(async () => {
  if (tournamentId) await service.from('tournaments').delete().eq('id', tournamentId);
});

test('migrateSheetData creates tournament, categories, courts, teams, matches', async () => {
  const result = await migrateSheetData({
    scheduleCsvText: SCHEDULE_CSV,
    tournament: { name: 'Migration Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26' },
    supabaseUrl: url,
    serviceKey,
  });
  tournamentId = result.tournamentId;

  const categories = await service.from('categories').select().eq('tournament_id', tournamentId);
  assert.equal(categories.data.length, 1);
  assert.equal(categories.data[0].name, 'U18 M Silver');

  const courts = await service.from('courts').select().eq('tournament_id', tournamentId);
  assert.equal(courts.data.length, 1);

  const teams = await service.from('teams').select().eq('category_id', categories.data[0].id);
  assert.equal(teams.data.length, 3); // Chile, India, Namibia

  const matches = await service.from('matches').select().in('sheet_match_nr', [16, 17]);
  assert.equal(matches.data.length, 2);
  const m16 = matches.data.find((m) => m.sheet_match_nr === 16);
  assert.equal(m16.status, 'finished');
  assert.equal(m16.best_of, 5);
});

test('migrateSheetData is idempotent (safe to re-run)', async () => {
  const result = await migrateSheetData({
    scheduleCsvText: SCHEDULE_CSV,
    tournament: { name: 'Migration Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26' },
    supabaseUrl: url,
    serviceKey,
    existingTournamentId: tournamentId,
  });
  assert.equal(result.tournamentId, tournamentId);
  const matches = await service.from('matches').select().in('sheet_match_nr', [16, 17]);
  assert.equal(matches.data.length, 2, 're-running must not create duplicate matches');
});
