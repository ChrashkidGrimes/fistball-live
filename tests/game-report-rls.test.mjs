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
let tournamentId, categoryId, teamAId, teamBId, matchId, playerId;

before(async () => {
  const t = await service.from('tournaments').insert({
    name: 'Game Report RLS Test Tournament', start_date: '2026-07-23', end_date: '2026-07-26',
  }).select().single();
  tournamentId = t.data.id;
  const c = await service.from('categories').insert({
    tournament_id: tournamentId, name: 'Game Report RLS Test Category', format: 'round_robin',
  }).select().single();
  categoryId = c.data.id;
  const teams = await service.from('teams').insert([
    { category_id: categoryId, name: 'Game Report RLS Team A' },
    { category_id: categoryId, name: 'Game Report RLS Team B' },
  ]).select();
  teamAId = teams.data[0].id;
  teamBId = teams.data[1].id;
  const m = await service.from('matches').insert({
    category_id: categoryId, team_a_id: teamAId, team_b_id: teamBId, sheet_match_nr: 999301,
  }).select().single();
  matchId = m.data.id;
  const p = await service.from('players').insert({
    team_id: teamAId, family_name: 'Test', given_name: 'Player', jersey_number: 1, role: 'player',
  }).select().single();
  playerId = p.data.id;
});

after(async () => {
  await service.from('player_events').delete().eq('match_id', matchId);
  await service.from('substitutions').delete().eq('match_id', matchId);
  await service.from('match_incidents').delete().eq('match_id', matchId);
  await service.from('players').delete().eq('team_id', teamAId);
  await service.from('matches').delete().eq('id', matchId);
  await service.from('teams').delete().in('id', [teamAId, teamBId]);
  await service.from('categories').delete().eq('id', categoryId);
  await service.from('tournaments').delete().eq('id', tournamentId);
});

async function signIn(email, password) {
  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `sign-in failed for ${email}: ${error?.message}`);
  return client;
}

test('admin can insert a player, scorer cannot', async () => {
  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { data, error } = await admin.from('players')
    .insert({ team_id: teamAId, family_name: 'Admin', given_name: 'Added', role: 'player' }).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  await service.from('players').delete().eq('id', data[0].id);

  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { error: scorerError } = await scorer.from('players')
    .insert({ team_id: teamAId, family_name: 'Scorer', given_name: 'Added', role: 'player' });
  assert.ok(scorerError, 'scorer should not be able to insert players');
});

test('scorer can insert a player_event, admin cannot', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data, error } = await scorer.from('player_events')
    .insert({ match_id: matchId, player_id: playerId, event_type: 'Y' }).select();
  assert.equal(error, null);
  assert.equal(data.length, 1);
  await service.from('player_events').delete().eq('id', data[0].id);

  const admin = await signIn('admin@fistball-ems.local', adminPassword);
  const { error: adminError } = await admin.from('player_events')
    .insert({ match_id: matchId, player_id: playerId, event_type: 'Y' });
  assert.ok(adminError, 'admin should not be able to insert player_events');
});

test('scorer can insert a substitution and a match_incident', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { data: player2 } = await service.from('players').insert({
    team_id: teamAId, family_name: 'Test2', given_name: 'Player2', jersey_number: 2, role: 'player',
  }).select().single();

  const sub = await scorer.from('substitutions').insert({
    match_id: matchId, set_number: 1, team_id: teamAId, player_out_id: playerId, player_in_id: player2.id,
  }).select();
  assert.equal(sub.error, null);
  assert.equal(sub.data.length, 1);

  const incident = await scorer.from('match_incidents').insert({
    match_id: matchId, incident_type: 'other', note: 'test',
  }).select();
  assert.equal(incident.error, null);
  assert.equal(incident.data.length, 1);

  await service.from('substitutions').delete().eq('id', sub.data[0].id);
  await service.from('match_incidents').delete().eq('id', incident.data[0].id);
  await service.from('players').delete().eq('id', player2.id);
});

test('anon can read players/player_events/substitutions/match_incidents', async () => {
  const anon = createClient(url, anonKey);
  const { data, error } = await anon.from('players').select().eq('id', playerId);
  assert.equal(error, null);
  assert.equal(data.length, 1);
});

test('scorer can no longer write sets/point_events directly', async () => {
  const scorer = await signIn('scorer@fistball-ems.local', scorerPassword);
  const { error } = await scorer.from('sets')
    .insert({ match_id: matchId, set_number: 999, points_a: 0, points_b: 0 });
  assert.ok(error, 'direct sets insert should now be rejected — only RPCs may write sets/point_events');
});
