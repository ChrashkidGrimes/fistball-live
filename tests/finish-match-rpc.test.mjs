import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const scorerPassword = process.env.SEED_SCORER_PASSWORD;
for (const [k, v] of Object.entries({ url, anonKey, serviceKey, adminPassword, scorerPassword })) {
  if (!v) throw new Error(`Missing env var for ${k} — see .env.example`);
}

const service = createClient(url, serviceKey);
let tournamentId, categoryId, teamAId, teamBId, admin, scorer;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Finish Match RPC Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Finish Match RPC Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Finish Match RPC Team A' },
    { category_id: categoryId, name: 'Finish Match RPC Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;

  admin = createClient(url, anonKey);
  await admin.auth.signInWithPassword({ email: 'admin@fistball-ems.local', password: adminPassword });
  scorer = createClient(url, anonKey);
  await scorer.auth.signInWithPassword({ email: 'scorer@fistball-ems.local', password: scorerPassword });
});

after(async () => {
  await service.from('matches').delete().eq('category_id', categoryId);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

async function makeMatch(sheetNr, extra = {}) {
  const { data } = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: sheetNr, best_of: 3, ...extra,
  }).select().single();
  return data.id;
}

test('finish_match computes the winner from decisive sets and works from status=live', async () => {
  const matchId = await makeMatch(999500, { status: 'live' });
  await service.from('sets').insert([
    { match_id: matchId, set_number: 1, points_a: 11, points_b: 5, winner_team_id: teamAId },
    { match_id: matchId, set_number: 2, points_a: 11, points_b: 7, winner_team_id: teamAId },
  ]);
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId });
  assert.equal(error, null);
  const { data } = await service.from('matches').select('status, winner_team_id').eq('id', matchId).single();
  assert.equal(data.status, 'finished');
  assert.equal(data.winner_team_id, teamAId);
});

test('finish_match also works from status=scheduled when sets are already decisive', async () => {
  const matchId = await makeMatch(999501, { status: 'scheduled' });
  await service.from('sets').insert([
    { match_id: matchId, set_number: 1, points_a: 11, points_b: 5, winner_team_id: teamAId },
    { match_id: matchId, set_number: 2, points_a: 11, points_b: 7, winner_team_id: teamAId },
  ]);
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId });
  assert.equal(error, null);
  const { data } = await service.from('matches').select('status').eq('id', matchId).single();
  assert.equal(data.status, 'finished');
});

test('finish_match rejects a match with no decisive winner and no override', async () => {
  const matchId = await makeMatch(999502, { status: 'scheduled' });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId });
  assert.ok(error, 'expected an error, no sets recorded');
});

test('finish_match accepts an explicit winner override with no sets (forfeit case)', async () => {
  const matchId = await makeMatch(999503, { status: 'scheduled' });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamBId });
  assert.equal(error, null);
  const { data } = await service.from('matches').select('status, winner_team_id').eq('id', matchId).single();
  assert.equal(data.status, 'finished');
  assert.equal(data.winner_team_id, teamBId);
});

test('finish_match rejects an override that is not one of the match teams', async () => {
  const matchId = await makeMatch(999504, { status: 'scheduled' });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: categoryId });
  assert.ok(error, 'expected rejection, categoryId is not a team of this match');
});

test('finish_match rejects a match that is already finished', async () => {
  const matchId = await makeMatch(999505, { status: 'scheduled' });
  await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamAId });
  const { error } = await admin.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamBId });
  assert.ok(error, 'expected rejection, match already finished');
});

test('finish_match resolves a dependent match\'s winner and loser slots', async () => {
  const sourceId = await makeMatch(999506, { status: 'live' });
  const winnerSlot = await service.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: sourceId, team_a_source_outcome: 'winner',
    team_b_id: teamAId, sheet_match_nr: 999507,
  }).select().single();
  const loserSlot = await service.from('matches').insert({
    category_id: categoryId, team_a_id: null, team_a_source_match_id: sourceId, team_a_source_outcome: 'loser',
    team_b_id: teamAId, sheet_match_nr: 999508,
  }).select().single();

  const { error } = await admin.rpc('finish_match', { p_match_id: sourceId, p_winner_team_id_override: teamAId });
  assert.equal(error, null);

  const { data: resolvedWinnerSlot } = await service.from('matches')
    .select('team_a_id, team_a_source_match_id').eq('id', winnerSlot.data.id).single();
  assert.equal(resolvedWinnerSlot.team_a_id, teamAId);
  assert.equal(resolvedWinnerSlot.team_a_source_match_id, null);

  const { data: resolvedLoserSlot } = await service.from('matches')
    .select('team_a_id, team_a_source_match_id').eq('id', loserSlot.data.id).single();
  assert.equal(resolvedLoserSlot.team_a_id, teamBId);
  assert.equal(resolvedLoserSlot.team_a_source_match_id, null);
});

test('scorer cannot call finish_match (admin only)', async () => {
  const matchId = await makeMatch(999509, { status: 'scheduled' });
  const { error } = await scorer.rpc('finish_match', { p_match_id: matchId, p_winner_team_id_override: teamAId });
  assert.ok(error, 'expected rejection, scorer is not admin');
});

test('admin can no longer set status=finished via a direct table update', async () => {
  const matchId = await makeMatch(999510, { status: 'scheduled' });
  const { error } = await admin.from('matches').update({ status: 'finished' }).eq('id', matchId);
  assert.ok(error, 'expected the direct-finish guard trigger to reject this update');
});
