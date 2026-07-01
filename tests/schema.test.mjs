import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example) before running this test.');
}

const db = createClient(url, serviceKey);
let tournamentId, categoryId, courtId, teamAId, teamBId;

before(async () => {
  const { data: t, error: tErr } = await db.from('tournaments').insert({
    name: 'Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  assert.equal(tErr, null);
  tournamentId = t.id;

  const { data: c, error: cErr } = await db.from('categories').insert({
    tournament_id: tournamentId, name: 'Test Category', format: 'round_robin',
  }).select().single();
  assert.equal(cErr, null);
  categoryId = c.id;

  const { data: court, error: courtErr } = await db.from('courts').insert({
    tournament_id: tournamentId, name: 'Court 1',
  }).select().single();
  assert.equal(courtErr, null);
  courtId = court.id;

  const { data: teams, error: teamsErr } = await db.from('teams').insert([
    { category_id: categoryId, name: 'Team A' },
    { category_id: categoryId, name: 'Team B' },
  ]).select();
  assert.equal(teamsErr, null);
  teamAId = teams[0].id;
  teamBId = teams[1].id;
});

after(async () => {
  await db.from('tournaments').delete().eq('id', tournamentId);
});

test('a match can reference an existing team/court/category', async () => {
  const { data, error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, court_id: courtId,
    best_of: 5, sheet_match_nr: 999001,
  }).select().single();
  assert.equal(error, null);
  assert.equal(data.status, 'scheduled');
  await db.from('matches').delete().eq('id', data.id);
});

test('a match cannot reference a non-existent team (FK enforced)', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: '00000000-0000-0000-0000-000000000000', team_b_id: teamBId,
    sheet_match_nr: 999002,
  });
  assert.ok(error, 'expected a foreign key violation error');
});

test('deleting a team referenced by a match is blocked', async () => {
  const { data: match } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999003,
  }).select().single();
  const { error } = await db.from('teams').delete().eq('id', teamAId);
  assert.ok(error, 'expected a foreign key violation error');
  await db.from('matches').delete().eq('id', match.id);
});
