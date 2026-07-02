import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example)');

const db = createClient(url, serviceKey);
let tournamentId, categoryId, teamAId, teamBId, matchAId;

before(async () => {
  const t = await db.from('tournaments').insert({
    name: 'Spielplan Schema Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await db.from('categories').insert({
    tournament_id: tournamentId, name: 'Spielplan Schema Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await db.from('teams').insert([
    { category_id: categoryId, name: 'Spielplan Schema Team A' },
    { category_id: categoryId, name: 'Spielplan Schema Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999400,
  }).select().single();
  matchAId = m.data.id;
});

after(async () => {
  await db.from('matches').delete().eq('category_id', categoryId);
  await db.from('teams').delete().in('id', [teamAId, teamBId]);
  await db.from('categories').delete().eq('id', categoryId);
  await db.from('tournaments').delete().eq('id', tournamentId);
});

test('a match can be created with a source instead of a fixed team_a', async () => {
  const { data, error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: matchAId, team_a_source_outcome: 'winner',
    team_b_id: teamBId, sheet_match_nr: 999401,
  }).select().single();
  assert.equal(error, null);
  assert.equal(data.team_a_id, null);
  assert.equal(data.team_a_source_match_id, matchAId);
  await db.from('matches').delete().eq('id', data.id);
});

test('a match cannot have both a fixed team_a and a source (xor constraint)', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_a_source_match_id: matchAId, team_a_source_outcome: 'winner',
    team_b_id: teamBId, sheet_match_nr: 999402,
  });
  assert.ok(error, 'expected the xor check constraint to reject this row');
});

test('a match cannot have neither a fixed team_a nor a source (xor constraint)', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_b_id: teamBId, sheet_match_nr: 999403,
  });
  assert.ok(error, 'expected the xor check constraint to reject this row');
});

test('team_a_source_outcome only accepts winner or loser', async () => {
  const { error } = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: matchAId, team_a_source_outcome: 'bogus',
    team_b_id: teamBId, sheet_match_nr: 999404,
  });
  assert.ok(error, 'expected the check constraint on team_a_source_outcome to reject an invalid value');
});

test('deleting a source match that a dependent still needs is blocked (on delete restrict)', async () => {
  const source = await db.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999405,
  }).select().single();
  const dependent = await db.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: source.data.id, team_a_source_outcome: 'winner',
    team_b_id: teamBId, sheet_match_nr: 999406,
  }).select().single();
  const { error } = await db.from('matches').delete().eq('id', source.data.id);
  assert.ok(error, 'expected FK restrict to block deleting a still-referenced source match');
  await db.from('matches').delete().eq('id', dependent.data.id);
  await db.from('matches').delete().eq('id', source.data.id);
});

test('winner_team_id defaults to null and accepts a team from the match', async () => {
  const { data, error } = await db.from('matches').update({ winner_team_id: teamAId }).eq('id', matchAId).select().single();
  assert.equal(error, null);
  assert.equal(data.winner_team_id, teamAId);
  await db.from('matches').update({ winner_team_id: null }).eq('id', matchAId);
});
