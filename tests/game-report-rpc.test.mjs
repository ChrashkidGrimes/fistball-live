import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const scorerPassword = process.env.SEED_SCORER_PASSWORD;
for (const [k, v] of Object.entries({ url, anonKey, serviceKey, scorerPassword })) {
  if (!v) throw new Error(`Missing env var for ${k} — see .env.example`);
}

const service = createClient(url, serviceKey);
let tournamentId, categoryId, teamAId, teamBId, matchId, scorer;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Game Report RPC Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Game Report RPC Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Game Report RPC Team A' },
    { category_id: categoryId, name: 'Game Report RPC Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999302, status: 'live',
  }).select().single();
  matchId = m.data.id;

  scorer = createClient(url, anonKey);
  const { error } = await scorer.auth.signInWithPassword({
    email: 'scorer@fistball-ems.local', password: scorerPassword,
  });
  assert.equal(error, null, `scorer sign-in failed: ${error?.message}`);
});

after(async () => {
  const { data: setRows } = await service.from('sets').select('id').eq('match_id', matchId);
  const setIds = (setRows || []).map((s) => s.id);
  if (setIds.length) await service.from('point_events').delete().in('set_id', setIds);
  await service.from('sets').delete().eq('match_id', matchId);
  await service.from('matches').delete().eq('id', matchId);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

test('record_point accumulates and detects an 11-9 win', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 1, points_a: 10, points_b: 9 });
  const { error } = await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 1, p_team: 'a' });
  assert.equal(error, null);
  const { data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 1).single();
  assert.equal(data.points_a, 11);
  assert.equal(data.points_b, 9);
  assert.equal(data.winner_team_id, teamAId);
});

test('record_point applies the 15:14 sudden-death cap', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 2, points_a: 14, points_b: 14 });
  const { error } = await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 2, p_team: 'b' });
  assert.equal(error, null);
  const { data } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 2).single();
  assert.equal(data.points_b, 15);
  assert.equal(data.winner_team_id, teamBId);
});

test('record_point rejects further scoring once a set is decided', async () => {
  await service.from('sets')
    .insert({ match_id: matchId, set_number: 3, points_a: 11, points_b: 5, winner_team_id: teamAId });
  const { error } = await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 3, p_team: 'b' });
  assert.ok(error, 'expected an error, the set is already decided');
});

test('record_point rejects scoring on a non-live match', async () => {
  const { data: scheduledMatch } = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999303,
  }).select().single();
  const { error } = await scorer.rpc('record_point', { p_match_id: scheduledMatch.id, p_set_number: 1, p_team: 'a' });
  assert.ok(error, 'expected an error, match is not live');
  await service.from('matches').delete().eq('id', scheduledMatch.id);
});

test('anon cannot call record_point', async () => {
  const anon = createClient(url, anonKey);
  const { error } = await anon.rpc('record_point', { p_match_id: matchId, p_set_number: 4, p_team: 'a' });
  assert.ok(error, 'expected anon to be rejected');
});

test('tag_last_point sets the event_type of the most recent point', async () => {
  await service.from('sets').insert({ match_id: matchId, set_number: 5, points_a: 0, points_b: 0 });
  await scorer.rpc('record_point', { p_match_id: matchId, p_set_number: 5, p_team: 'a' });
  const { error } = await scorer.rpc('tag_last_point', { p_match_id: matchId, p_set_number: 5, p_detail: 'ace' });
  assert.equal(error, null);
  const { data: set } = await service.from('sets').select().eq('match_id', matchId).eq('set_number', 5).single();
  const { data: events } = await service.from('point_events').select()
    .eq('set_id', set.id).order('created_at', { ascending: false }).limit(1);
  assert.equal(events[0].event_type, 'ace');
});
